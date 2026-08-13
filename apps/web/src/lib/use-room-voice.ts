import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  Player,
  VoiceSignal,
  VoiceSignalEvent,
  VoiceStateEvent,
} from "@workspace/game"

import type { GameSocket } from "@/lib/realtime"
import { getRealtimeUrl } from "@/lib/realtime"
import {
  PEER_DISCONNECT_GRACE_MS,
  PEER_RECONCILE_INTERVAL_MS,
  hasTurnServers,
  isPeerStalled,
  nextRecoveryAction,
} from "@/lib/voice-recovery"

type VoicePeerState = {
  enabled: boolean
  muted: boolean
  speaking: boolean
}

type SilentAudioSource = {
  stream: MediaStream
  track: MediaStreamTrack
  cleanup: () => void
}

export type RoomVoiceController = {
  enabled: boolean
  connecting: boolean
  muted: boolean
  speaking: boolean
  error: string | null
  voiceStates: Partial<Record<string, VoicePeerState>>
  remoteStreamsByPlayerId: Partial<Record<string, MediaStream>>
  toggle: () => void
}

const defaultIceServers: Array<RTCIceServer> = [
  { urls: "stun:stun.l.google.com:19302" },
]

type PeerMeta = {
  relayOnly: boolean
  restartAttempts: number
  createdAt: number
  connectedAt: number | null
  disconnectTimerId: number | null
  lastRecoveryAt: number
}

/**
 * `connectionState` and `iceConnectionState` both go to "failed" at almost the
 * same moment, so recovery is debounced to keep one break from burning two
 * retries.
 */
const RECOVERY_DEBOUNCE_MS = 2_000

let voicePeerConfig: RTCConfiguration = {
  iceServers: getBuildTimeVoiceIceServers(),
}
let voicePeerConfigPromise: Promise<Array<RTCIceServer>> | null = null

function getBuildTimeVoiceIceServers(): Array<RTCIceServer> {
  const configuredServers = import.meta.env.VITE_RTC_ICE_SERVERS?.trim()
  if (!configuredServers) return defaultIceServers

  try {
    const parsedServers = normalizeVoiceIceServers(
      JSON.parse(configuredServers)
    )
    return parsedServers.length > 0 ? parsedServers : defaultIceServers
  } catch (cause) {
    console.error("Invalid VITE_RTC_ICE_SERVERS value", cause)
    return defaultIceServers
  }
}

async function loadVoicePeerConfig(): Promise<Array<RTCIceServer>> {
  if (voicePeerConfigPromise) return voicePeerConfigPromise

  voicePeerConfigPromise = (async () => {
    const fallbackServers = voicePeerConfig.iceServers ?? defaultIceServers

    try {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 3000)
      const response = await fetch(`${getRealtimeUrl()}/voice/ice-servers`, {
        cache: "no-store",
        signal: controller.signal,
      })
      window.clearTimeout(timeoutId)

      if (!response.ok) return fallbackServers

      const payload = (await response.json()) as { iceServers?: unknown }
      const runtimeServers = normalizeVoiceIceServers(payload.iceServers)
      const nextServers =
        runtimeServers.length > 1 || fallbackServers.length <= 1
          ? runtimeServers
          : fallbackServers

      if (nextServers.length > 0) {
        voicePeerConfig = { iceServers: nextServers }
      }
    } catch (cause) {
      logRoomVoiceDebug("ice server config fetch failed", { cause })
    }

    logRoomVoiceDebug("ice server config loaded", {
      iceServers: (voicePeerConfig.iceServers ?? []).map(
        (server) => server.urls
      ),
    })
    return voicePeerConfig.iceServers ?? defaultIceServers
  })()

  return voicePeerConfigPromise
}

function normalizeVoiceIceServers(value: unknown): Array<RTCIceServer> {
  if (!Array.isArray(value)) return []

  return value.flatMap((server) => {
    if (!server || typeof server !== "object" || !("urls" in server)) return []

    const urls = server.urls
    const normalizedUrls =
      typeof urls === "string"
        ? urls
        : Array.isArray(urls) && urls.every((url) => typeof url === "string")
          ? urls
          : null
    if (!normalizedUrls) return []

    const username =
      "username" in server && typeof server.username === "string"
        ? server.username
        : undefined
    const credential =
      "credential" in server && typeof server.credential === "string"
        ? server.credential
        : undefined
    const credentialType =
      "credentialType" in server &&
      (server.credentialType === "password" ||
        server.credentialType === "oauth")
        ? server.credentialType
        : undefined

    return [{ urls: normalizedUrls, username, credential, credentialType }]
  })
}

function getBrowserAudioContext(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined
  const audioWindow = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext
}

export function isRoomVoiceDebugEnabled() {
  if (import.meta.env.DEV || import.meta.env.VITE_VOICE_DEBUG === "true") {
    return true
  }

  if (typeof window === "undefined") return false

  try {
    const searchParams = new URLSearchParams(window.location.search)
    return (
      window.localStorage.getItem("uno:voice-debug") === "1" ||
      searchParams.get("voiceDebug") === "1"
    )
  } catch {
    return false
  }
}

export function logRoomVoiceDebug(
  event: string,
  details?: Record<string, unknown>
) {
  if (!isRoomVoiceDebugEnabled()) return
  console.debug(`[uno voice] ${event}`, details ?? {})
}

function describeTrack(track: MediaStreamTrack | null | undefined) {
  if (!track) return null

  return {
    id: track.id,
    kind: track.kind,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  }
}

function describeCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return null

  const candidateValue =
    "candidate" in candidate && typeof candidate.candidate === "string"
      ? candidate.candidate
      : ""

  return {
    type: candidateValue.match(/ typ ([a-z]+)/i)?.[1] ?? "unknown",
    protocol:
      candidateValue.match(/ (udp|tcp) /i)?.[1]?.toLowerCase() ?? "unknown",
  }
}

function describeSignal(signal: VoiceSignal) {
  if (signal.type === "offer" || signal.type === "answer") {
    return { type: signal.type, sdpLength: signal.sdp.length }
  }

  if (signal.type === "leave") {
    return { type: signal.type }
  }

  return {
    type: signal.type,
    candidate: describeCandidate(signal.candidate),
  }
}

export function useRoomVoice({
  socket,
  roomCode,
  selfPlayerId,
  players,
}: {
  socket: GameSocket | null
  roomCode: string
  selfPlayerId: string | null
  players: Array<Player>
}): RoomVoiceController {
  const [enabled, setEnabled] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceStates, setVoiceStates] = useState<
    Partial<Record<string, VoicePeerState>>
  >({})
  const [remoteStreamsByPlayerId, setRemoteStreamsByPlayerId] = useState<
    Partial<Record<string, MediaStream>>
  >({})

  const socketRef = useRef<GameSocket | null>(socket)
  const selfPlayerIdRef = useRef<string | null>(selfPlayerId)
  const playersRef = useRef<Array<Player>>(players)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(muted)
  const speakingRef = useRef(speaking)
  const voiceStatesRef = useRef(voiceStates)
  const localStreamRef = useRef<MediaStream | null>(null)
  const silentAudioSourceRef = useRef<SilentAudioSource | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const peerMetaRef = useRef<Map<string, PeerMeta>>(new Map())
  const negotiatingPeersRef = useRef<Set<string>>(new Set())
  const pendingIceCandidatesRef = useRef<
    Map<string, Array<RTCIceCandidateInit>>
  >(new Map())
  const meterCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    socketRef.current = socket
  }, [socket])

  useEffect(() => {
    selfPlayerIdRef.current = selfPlayerId
  }, [selfPlayerId])

  useEffect(() => {
    playersRef.current = players
  }, [players])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])

  useEffect(() => {
    voiceStatesRef.current = voiceStates
  }, [voiceStates])

  const setVoiceStateForPlayer = useCallback(
    (playerId: string, state: VoicePeerState) => {
      setVoiceStates((current) => {
        if (!state.enabled) {
          if (!current[playerId]) return current
          const next = { ...current }
          delete next[playerId]
          return next
        }

        const currentState = current[playerId]
        if (
          currentState?.enabled === state.enabled &&
          currentState.muted === state.muted &&
          currentState.speaking === state.speaking
        ) {
          return current
        }

        return {
          ...current,
          [playerId]: state,
        }
      })
    },
    []
  )

  const emitVoiceState = useCallback((state: VoicePeerState) => {
    const activeSocket = socketRef.current
    if (!activeSocket) return
    activeSocket.emit("voice:setState", state)
  }, [])

  const emitSignal = useCallback(
    (targetPlayerId: string, signal: VoiceSignal) => {
      const activeSocket = socketRef.current
      if (!activeSocket) return
      logRoomVoiceDebug("signal sent", {
        targetPlayerId,
        signal: describeSignal(signal),
      })
      activeSocket.emit("voice:signal", { targetPlayerId, signal })
    },
    []
  )

  const clearDisconnectTimer = useCallback((playerId: string) => {
    const meta = peerMetaRef.current.get(playerId)
    if (meta?.disconnectTimerId) {
      window.clearTimeout(meta.disconnectTimerId)
      meta.disconnectTimerId = null
    }
  }, [])

  const closePeer = useCallback(
    (playerId: string) => {
      clearDisconnectTimer(playerId)
      peerMetaRef.current.delete(playerId)
      const peer = peersRef.current.get(playerId)
      if (peer) {
        logRoomVoiceDebug("peer closing", {
          remotePlayerId: playerId,
          signalingState: peer.signalingState,
          iceConnectionState: peer.iceConnectionState,
          connectionState: peer.connectionState,
        })
        peer.onicecandidate = null
        peer.ontrack = null
        peer.onconnectionstatechange = null
        peer.oniceconnectionstatechange = null
        peer.onsignalingstatechange = null
        peer.close()
      }

      peersRef.current.delete(playerId)
      negotiatingPeersRef.current.delete(playerId)
      pendingIceCandidatesRef.current.delete(playerId)
      setRemoteStreamsByPlayerId((current) => {
        if (!current[playerId]) return current
        const next = { ...current }
        delete next[playerId]
        return next
      })
    },
    [clearDisconnectTimer]
  )

  const closeAllPeers = useCallback(() => {
    for (const playerId of peersRef.current.keys()) closePeer(playerId)
  }, [closePeer])

  const stopSpeakingMeter = useCallback(() => {
    meterCleanupRef.current?.()
    meterCleanupRef.current = null
    if (speakingRef.current) {
      speakingRef.current = false
      setSpeaking(false)
    }
  }, [])

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
  }, [])

  const stopSilentAudioSource = useCallback(() => {
    const silentAudioSource = silentAudioSourceRef.current
    if (!silentAudioSource) return

    silentAudioSource.cleanup()
    silentAudioSourceRef.current = null
    logRoomVoiceDebug("silent source stopped")
  }, [])

  const getSilentAudioSource = useCallback(() => {
    const existingSource = silentAudioSourceRef.current
    if (existingSource?.track.readyState === "live") return existingSource

    if (typeof window === "undefined") return null

    const AudioContextClass = getBrowserAudioContext()
    if (!AudioContextClass) return null

    try {
      const audioContext = new AudioContextClass()
      const destination = audioContext.createMediaStreamDestination()
      const gain = audioContext.createGain()
      const oscillator = audioContext.createOscillator()
      gain.gain.value = 0
      oscillator.frequency.value = 440
      oscillator.connect(gain)
      gain.connect(destination)
      oscillator.start()

      const track = destination.stream.getAudioTracks().at(0)
      if (!track) {
        void audioContext.close()
        return null
      }

      track.enabled = true
      const source: SilentAudioSource = {
        stream: destination.stream,
        track,
        cleanup: () => {
          try {
            oscillator.stop()
          } catch {
            // The oscillator may already be stopped during StrictMode cleanup.
          }
          oscillator.disconnect()
          gain.disconnect()
          track.stop()
          void audioContext.close()
        },
      }

      silentAudioSourceRef.current = source
      logRoomVoiceDebug("silent source created", {
        track: describeTrack(track),
      })
      return source
    } catch (cause) {
      logRoomVoiceDebug("silent source failed", { cause })
      return null
    }
  }, [])

  const getOutboundAudioSource = useCallback(() => {
    const localStream = localStreamRef.current
    const localTrack = localStream?.getAudioTracks()[0]
    if (localStream && localTrack?.readyState === "live") {
      return {
        kind: "mic",
        stream: localStream,
        track: localTrack,
      }
    }

    const silentAudioSource = getSilentAudioSource()
    if (!silentAudioSource) return null

    return {
      kind: "silent",
      stream: silentAudioSource.stream,
      track: silentAudioSource.track,
    }
  }, [getSilentAudioSource])

  // Only the lower id opens the conversation, so two peers never collide on
  // the very first offer. Recovery offers can come from either side, which is
  // what `isPolite` resolves.
  const shouldCreateOffer = useCallback((remotePlayerId: string) => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId) return false
    return activeSelfPlayerId < remotePlayerId
  }, [])

  /** Perfect negotiation: the polite side yields when two offers cross. */
  const isPolite = useCallback(
    (remotePlayerId: string) => !shouldCreateOffer(remotePlayerId),
    [shouldCreateOffer]
  )

  const recoverPeerRef = useRef<(playerId: string, reason: string) => void>(
    () => {}
  )

  const shouldCreateInitialOffer = useCallback(
    (remotePlayerId: string, peer: RTCPeerConnection) => {
      if (!shouldCreateOffer(remotePlayerId)) return false
      if (peer.signalingState !== "stable") return false
      if (peer.localDescription || peer.remoteDescription) return false
      return true
    },
    [shouldCreateOffer]
  )

  const setRemoteAudioTrack = useCallback(
    (remotePlayerId: string, track: MediaStreamTrack) => {
      if (track.kind !== "audio") return
      logRoomVoiceDebug("remote audio track attached", {
        remotePlayerId,
        track: describeTrack(track),
      })
      setRemoteStreamsByPlayerId((current) => {
        const existingTrack = current[remotePlayerId]?.getAudioTracks()[0]
        if (existingTrack === track) return current
        return { ...current, [remotePlayerId]: new MediaStream([track]) }
      })
    },
    []
  )

  const syncRemoteAudioFromPeer = useCallback(
    (remotePlayerId: string, peer: RTCPeerConnection) => {
      for (const receiver of peer.getReceivers()) {
        if (receiver.track.kind === "audio") {
          setRemoteAudioTrack(remotePlayerId, receiver.track)
        }
      }
    },
    [setRemoteAudioTrack]
  )

  const syncLocalAudioToPeer = useCallback(
    async (peer: RTCPeerConnection, remotePlayerId: string) => {
      const outboundAudioSource = getOutboundAudioSource()
      const audioTransceiver = peer
        .getTransceivers()
        .find(
          (transceiver) =>
            transceiver.sender.track?.kind === "audio" ||
            transceiver.receiver.track.kind === "audio"
        )

      // Keep one stable audio m-line for the lifetime of the peer connection.
      // A silent placeholder track gives every browser a real remote track before
      // the player grants mic permission, then replaceTrack can swap in the mic.
      if (outboundAudioSource) {
        if (audioTransceiver) {
          if (audioTransceiver.sender.track !== outboundAudioSource.track) {
            await audioTransceiver.sender.replaceTrack(
              outboundAudioSource.track
            )
            logRoomVoiceDebug("sender track replaced", {
              remotePlayerId,
              source: outboundAudioSource.kind,
              track: describeTrack(outboundAudioSource.track),
              signalingState: peer.signalingState,
            })
          }
          if (audioTransceiver.direction !== "sendrecv") {
            audioTransceiver.direction = "sendrecv"
          }
        } else {
          peer.addTrack(outboundAudioSource.track, outboundAudioSource.stream)
          logRoomVoiceDebug("sender track added", {
            remotePlayerId,
            source: outboundAudioSource.kind,
            track: describeTrack(outboundAudioSource.track),
            signalingState: peer.signalingState,
          })
        }
        return
      }

      if (audioTransceiver) {
        if (audioTransceiver.direction !== "sendrecv") {
          audioTransceiver.direction = "sendrecv"
        }
        return
      }

      peer.addTransceiver("audio", { direction: "sendrecv" })
      logRoomVoiceDebug("empty audio transceiver added", { remotePlayerId })
    },
    [getOutboundAudioSource]
  )

  const ensurePeer = useCallback(
    (remotePlayerId: string) => {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (!activeSelfPlayerId || remotePlayerId === activeSelfPlayerId) {
        return null
      }

      const existingPeer = peersRef.current.get(remotePlayerId)
      if (existingPeer) return existingPeer

      const previousMeta = peerMetaRef.current.get(remotePlayerId)
      const relayOnly = Boolean(previousMeta?.relayOnly)
      const peer = new RTCPeerConnection({
        ...voicePeerConfig,
        ...(relayOnly ? { iceTransportPolicy: "relay" as const } : {}),
      })
      peerMetaRef.current.set(remotePlayerId, {
        relayOnly,
        restartAttempts: previousMeta?.restartAttempts ?? 0,
        createdAt: Date.now(),
        connectedAt: null,
        disconnectTimerId: null,
        lastRecoveryAt: 0,
      })
      logRoomVoiceDebug("peer created", {
        remotePlayerId,
        relayOnly,
        iceServers: voicePeerConfig.iceServers?.map((server) => server.urls),
      })
      void syncLocalAudioToPeer(peer, remotePlayerId)

      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        logRoomVoiceDebug("ice candidate sent", {
          remotePlayerId,
          candidate: describeCandidate(event.candidate.toJSON()),
        })
        emitSignal(remotePlayerId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        })
      }

      peer.ontrack = (event) => {
        logRoomVoiceDebug("ontrack", {
          remotePlayerId,
          track: describeTrack(event.track),
          streamCount: event.streams.length,
        })
        setRemoteAudioTrack(remotePlayerId, event.track)
      }

      peer.onconnectionstatechange = () => {
        logRoomVoiceDebug("connection state changed", {
          remotePlayerId,
          connectionState: peer.connectionState,
          iceConnectionState: peer.iceConnectionState,
        })

        const meta = peerMetaRef.current.get(remotePlayerId)
        if (peer.connectionState === "connected") {
          clearDisconnectTimer(remotePlayerId)
          if (meta) {
            meta.connectedAt = Date.now()
            meta.restartAttempts = 0
          }
          return
        }

        // A failed leg used to be closed for good, which is why a player could
        // hear some of the table but not the rest for the whole match. Now it
        // is repaired instead.
        if (peer.connectionState === "failed") {
          clearDisconnectTimer(remotePlayerId)
          recoverPeerRef.current(remotePlayerId, "connection-failed")
          return
        }

        if (peer.connectionState === "disconnected") {
          if (meta?.disconnectTimerId) return
          const timerId = window.setTimeout(() => {
            const currentPeer = peersRef.current.get(remotePlayerId)
            const currentMeta = peerMetaRef.current.get(remotePlayerId)
            if (currentMeta) currentMeta.disconnectTimerId = null
            if (!currentPeer || currentPeer.connectionState === "connected") {
              return
            }
            recoverPeerRef.current(remotePlayerId, "connection-disconnected")
          }, PEER_DISCONNECT_GRACE_MS)
          if (meta) meta.disconnectTimerId = timerId
          return
        }

        if (peer.connectionState === "closed") {
          closePeer(remotePlayerId)
        }
      }

      peer.oniceconnectionstatechange = () => {
        logRoomVoiceDebug("ice state changed", {
          remotePlayerId,
          iceConnectionState: peer.iceConnectionState,
          connectionState: peer.connectionState,
        })
        if (peer.iceConnectionState === "failed") {
          recoverPeerRef.current(remotePlayerId, "ice-failed")
        }
      }

      peer.onsignalingstatechange = () => {
        logRoomVoiceDebug("signaling state changed", {
          remotePlayerId,
          signalingState: peer.signalingState,
        })
      }

      peersRef.current.set(remotePlayerId, peer)
      return peer
    },
    [
      clearDisconnectTimer,
      closePeer,
      emitSignal,
      setRemoteAudioTrack,
      syncLocalAudioToPeer,
    ]
  )

  const flushPendingIceCandidates = useCallback(
    async (remotePlayerId: string, peer: RTCPeerConnection) => {
      const pendingCandidates =
        pendingIceCandidatesRef.current.get(remotePlayerId)
      if (!pendingCandidates?.length || !peer.remoteDescription) return

      pendingIceCandidatesRef.current.delete(remotePlayerId)
      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(candidate)
      }
      logRoomVoiceDebug("queued ice candidates flushed", {
        remotePlayerId,
        count: pendingCandidates.length,
      })
    },
    []
  )

  /**
   * Re-offers with an ICE restart so a broken leg can find a new candidate
   * pair. Either side may drive this — `isPolite` settles any collision.
   */
  const restartNegotiation = useCallback(
    async (remotePlayerId: string) => {
      const peer = peersRef.current.get(remotePlayerId)
      if (!peer || peer.signalingState === "closed") return
      if (negotiatingPeersRef.current.has(remotePlayerId)) return

      negotiatingPeersRef.current.add(remotePlayerId)
      try {
        await syncLocalAudioToPeer(peer, remotePlayerId)
        const offer = await peer.createOffer({ iceRestart: true })
        if (peer.signalingState !== "stable") return
        await peer.setLocalDescription(offer)
        if (!peer.localDescription?.sdp) return
        logRoomVoiceDebug("ice restart offer sent", {
          remotePlayerId,
          signalingState: peer.signalingState,
        })
        emitSignal(remotePlayerId, {
          type: "offer",
          sdp: peer.localDescription.sdp,
        })
      } catch (cause) {
        logRoomVoiceDebug("ice restart failed", { remotePlayerId, cause })
      } finally {
        negotiatingPeersRef.current.delete(remotePlayerId)
      }
    },
    [emitSignal, syncLocalAudioToPeer]
  )

  const createOffer = useCallback(
    async (remotePlayerId: string) => {
      if (negotiatingPeersRef.current.has(remotePlayerId)) return
      const peer = ensurePeer(remotePlayerId)
      if (!peer) return

      if (!shouldCreateInitialOffer(remotePlayerId, peer)) {
        logRoomVoiceDebug("initial offer skipped", {
          remotePlayerId,
          signalingState: peer.signalingState,
          connectionState: peer.connectionState,
          localDescription: peer.localDescription?.type ?? null,
          remoteDescription: peer.remoteDescription?.type ?? null,
        })
        return
      }

      negotiatingPeersRef.current.add(remotePlayerId)
      try {
        await syncLocalAudioToPeer(peer, remotePlayerId)
        if (!shouldCreateInitialOffer(remotePlayerId, peer)) {
          logRoomVoiceDebug("initial offer skipped after sync", {
            remotePlayerId,
            signalingState: peer.signalingState,
            connectionState: peer.connectionState,
            localDescription: peer.localDescription?.type ?? null,
            remoteDescription: peer.remoteDescription?.type ?? null,
          })
          return
        }
        const offer = await peer.createOffer()
        if (peer.signalingState !== "stable") return
        await peer.setLocalDescription(offer)
        if (!peer.localDescription?.sdp) return
        logRoomVoiceDebug("offer sent", {
          remotePlayerId,
          signalingState: peer.signalingState,
          localDescriptionType: peer.localDescription.type,
        })
        emitSignal(remotePlayerId, {
          type: "offer",
          sdp: peer.localDescription.sdp,
        })
      } catch (cause) {
        console.error("Voice offer failed", cause)
      } finally {
        negotiatingPeersRef.current.delete(remotePlayerId)
      }
    },
    [emitSignal, ensurePeer, shouldCreateInitialOffer, syncLocalAudioToPeer]
  )

  const connectToEnabledPeers = useCallback(() => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId || !enabledRef.current) return

    for (const player of playersRef.current) {
      if (player.id === activeSelfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue
      const peer = ensurePeer(player.id)
      if (peer && shouldCreateInitialOffer(player.id, peer)) {
        void createOffer(player.id)
      }
    }
  }, [createOffer, ensurePeer, shouldCreateInitialOffer])

  /**
   * Repairs one leg of the mesh. First an ICE restart; if the link keeps
   * failing and TURN is configured, the peer is rebuilt as relay-only, which
   * is what gets two players behind unfriendly Wi-Fi NATs talking.
   */
  const recoverPeer = useCallback(
    (remotePlayerId: string, reason: string) => {
      if (!enabledRef.current) return
      if (!voiceStatesRef.current[remotePlayerId]?.enabled) return
      if (!playersRef.current.some((player) => player.id === remotePlayerId)) {
        return
      }

      const meta = peerMetaRef.current.get(remotePlayerId)
      const now = Date.now()
      if (meta && now - meta.lastRecoveryAt < RECOVERY_DEBOUNCE_MS) {
        logRoomVoiceDebug("peer recovery skipped", { remotePlayerId, reason })
        return
      }
      if (meta) meta.lastRecoveryAt = now

      const restartAttempts = meta?.restartAttempts ?? 0
      const relayOnly = Boolean(meta?.relayOnly)
      const action = nextRecoveryAction({
        restartAttempts,
        relayOnly,
        turnAvailable: hasTurnServers(voicePeerConfig.iceServers),
      })
      logRoomVoiceDebug("peer recovery", {
        remotePlayerId,
        reason,
        restartAttempts,
        relayOnly,
        action,
      })

      if (meta) meta.restartAttempts = restartAttempts + 1

      if (action === "ice-restart") {
        if (meta) {
          meta.createdAt = now
          meta.connectedAt = null
        }
        void restartNegotiation(remotePlayerId)
        return
      }

      closePeer(remotePlayerId)
      if (action === "rebuild-relay") {
        peerMetaRef.current.set(remotePlayerId, {
          relayOnly: true,
          restartAttempts: 0,
          createdAt: now,
          connectedAt: null,
          disconnectTimerId: null,
          lastRecoveryAt: now,
        })
      }

      const peer = ensurePeer(remotePlayerId)
      // Whoever notices the break rebuilds; the other side answers.
      if (peer) void restartNegotiation(remotePlayerId)
    },
    [closePeer, ensurePeer, restartNegotiation]
  )

  useEffect(() => {
    recoverPeerRef.current = recoverPeer
  }, [recoverPeer])

  /**
   * Watchdog for the silent failures: a peer that never finished connecting,
   * or a remote player who is on voice but has no peer at all on this side.
   */
  const reconcileMesh = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || !enabledRef.current) return

    const now = Date.now()
    for (const player of playersRef.current) {
      if (player.id === selfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue

      const peer = peersRef.current.get(player.id)
      if (!peer) {
        const created = ensurePeer(player.id)
        if (created && shouldCreateInitialOffer(player.id, created)) {
          void createOffer(player.id)
        }
        continue
      }

      const meta = peerMetaRef.current.get(player.id)
      const stalled = isPeerStalled({
        connectionState: peer.connectionState,
        connectedAt: meta?.connectedAt ?? null,
        createdAt: meta?.createdAt ?? now,
        now,
      })
      if (!stalled) continue

      recoverPeer(player.id, `stalled-${peer.connectionState}`)
    }
  }, [createOffer, ensurePeer, recoverPeer, shouldCreateInitialOffer])

  useEffect(() => {
    if (!enabled) return
    const intervalId = window.setInterval(
      reconcileMesh,
      PEER_RECONCILE_INTERVAL_MS
    )
    return () => window.clearInterval(intervalId)
  }, [enabled, reconcileMesh])

  const syncAllPeers = useCallback(async () => {
    const tasks: Array<Promise<void>> = []
    for (const [playerId, peer] of peersRef.current) {
      tasks.push(syncLocalAudioToPeer(peer, playerId))
    }
    await Promise.all(tasks)
  }, [syncLocalAudioToPeer])

  const publishLocalVoiceState = useCallback(
    (state: VoicePeerState) => {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (!activeSelfPlayerId) return
      setVoiceStateForPlayer(activeSelfPlayerId, state)
      emitVoiceState(state)
    },
    [emitVoiceState, setVoiceStateForPlayer]
  )

  const startListening = useCallback(async () => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId || enabledRef.current) return

    setConnecting(true)
    setError(null)
    try {
      await loadVoicePeerConfig()
    } finally {
      setConnecting(false)
    }

    if (!selfPlayerIdRef.current) return

    enabledRef.current = true
    mutedRef.current = true
    speakingRef.current = false
    setEnabled(true)
    setMuted(true)
    setSpeaking(false)
    publishLocalVoiceState({ enabled: true, muted: true, speaking: false })
    logRoomVoiceDebug("joined voice as listener", {
      selfPlayerId: activeSelfPlayerId,
    })
    socketRef.current?.emit("voice:requestStates")
    connectToEnabledPeers()
  }, [connectToEnabledPeers, publishLocalVoiceState])

  const setLocalMuted = useCallback(
    async (nextMuted: boolean) => {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (!activeSelfPlayerId || !enabledRef.current || !localStreamRef.current)
        return

      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted
      }

      mutedRef.current = nextMuted
      setMuted(nextMuted)

      if (nextMuted && speakingRef.current) {
        speakingRef.current = false
        setSpeaking(false)
      }

      const state = {
        enabled: true,
        muted: nextMuted,
        speaking: nextMuted ? false : speakingRef.current,
      }
      publishLocalVoiceState(state)
      logRoomVoiceDebug("local mute changed", {
        selfPlayerId: activeSelfPlayerId,
        muted: nextMuted,
        localTrack: describeTrack(localStreamRef.current.getAudioTracks()[0]),
      })
      await syncAllPeers()
    },
    [publishLocalVoiceState, syncAllPeers]
  )

  const stop = useCallback(() => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    setConnecting(false)
    setEnabled(false)
    setMuted(true)
    enabledRef.current = false
    mutedRef.current = true
    stopSpeakingMeter()
    stopLocalStream()
    stopSilentAudioSource()
    closeAllPeers()
    emitVoiceState({ enabled: false, muted: true, speaking: false })
    if (activeSelfPlayerId) {
      setVoiceStateForPlayer(activeSelfPlayerId, {
        enabled: false,
        muted: true,
        speaking: false,
      })
    }
  }, [
    closeAllPeers,
    emitVoiceState,
    setVoiceStateForPlayer,
    stopSilentAudioSource,
    stopLocalStream,
    stopSpeakingMeter,
  ])

  const startSpeakingMeter = useCallback(
    (stream: MediaStream) => {
      stopSpeakingMeter()

      const AudioContextClass = getBrowserAudioContext()
      if (!AudioContextClass) return

      const audioContext = new AudioContextClass()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.7

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      const samples = new Uint8Array(analyser.fftSize)
      let lastSpeaking = false
      const intervalId = window.setInterval(() => {
        const activeSelfPlayerId = selfPlayerIdRef.current
        if (!activeSelfPlayerId || !enabledRef.current) return

        if (mutedRef.current) {
          if (!lastSpeaking) return
          lastSpeaking = false
          speakingRef.current = false
          setSpeaking(false)
          const state = { enabled: true, muted: true, speaking: false }
          setVoiceStateForPlayer(activeSelfPlayerId, state)
          emitVoiceState(state)
          return
        }

        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const centered = (sample - 128) / 128
          sum += centered * centered
        }

        const rms = Math.sqrt(sum / samples.length)
        const nextSpeaking = rms > 0.045
        if (nextSpeaking === lastSpeaking) return

        lastSpeaking = nextSpeaking
        speakingRef.current = nextSpeaking
        setSpeaking(nextSpeaking)
        const state = { enabled: true, muted: false, speaking: nextSpeaking }
        setVoiceStateForPlayer(activeSelfPlayerId, state)
        emitVoiceState(state)
      }, 150)

      meterCleanupRef.current = () => {
        window.clearInterval(intervalId)
        source.disconnect()
        analyser.disconnect()
        void audioContext.close()
      }
    },
    [emitVoiceState, setVoiceStateForPlayer, stopSpeakingMeter]
  )

  const start = useCallback(async () => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId || connecting) return
    if (localStreamRef.current) {
      await setLocalMuted(false)
      return
    }
    const mediaDevices = (
      navigator as unknown as {
        mediaDevices?: {
          getUserMedia?: MediaDevices["getUserMedia"]
        }
      }
    ).mediaDevices
    if (typeof mediaDevices?.getUserMedia !== "function") {
      setError("Voice chat is not available in this browser.")
      return
    }

    setConnecting(true)
    setError(null)

    try {
      await loadVoicePeerConfig()
      const stream = await mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })

      for (const track of stream.getAudioTracks()) {
        track.enabled = true
      }

      localStreamRef.current = stream
      enabledRef.current = true
      mutedRef.current = false
      setEnabled(true)
      setMuted(false)
      const state = { enabled: true, muted: false, speaking: false }
      publishLocalVoiceState(state)
      logRoomVoiceDebug("local mic started", {
        selfPlayerId: activeSelfPlayerId,
        localTrack: describeTrack(stream.getAudioTracks()[0]),
      })
      socketRef.current?.emit("voice:requestStates")
      startSpeakingMeter(stream)
      await syncAllPeers()
      connectToEnabledPeers()
    } catch (cause) {
      stopLocalStream()
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Mic permission was blocked."
          : "Could not start voice chat."
      )
    } finally {
      setConnecting(false)
    }
  }, [
    connectToEnabledPeers,
    connecting,
    publishLocalVoiceState,
    setLocalMuted,
    startSpeakingMeter,
    stopLocalStream,
    syncAllPeers,
  ])

  const handleIncomingSignal = useCallback(
    async (event: VoiceSignalEvent) => {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (
        !activeSelfPlayerId ||
        event.targetPlayerId !== activeSelfPlayerId ||
        event.fromPlayerId === activeSelfPlayerId ||
        !enabledRef.current
      ) {
        return
      }

      const peer = ensurePeer(event.fromPlayerId)
      if (!peer) return

      try {
        logRoomVoiceDebug("signal received", {
          fromPlayerId: event.fromPlayerId,
          signal: describeSignal(event.signal),
          signalingState: peer.signalingState,
          connectionState: peer.connectionState,
        })

        switch (event.signal.type) {
          case "offer": {
            const collides =
              peer.signalingState !== "stable" ||
              negotiatingPeersRef.current.has(event.fromPlayerId)
            if (collides && !isPolite(event.fromPlayerId)) {
              // Impolite side keeps its own offer; the other end will answer it.
              logRoomVoiceDebug("colliding offer ignored", {
                remotePlayerId: event.fromPlayerId,
                signalingState: peer.signalingState,
              })
              break
            }
            if (peer.signalingState !== "stable") {
              try {
                await peer.setLocalDescription({ type: "rollback" })
                logRoomVoiceDebug("rolled back local description", {
                  remotePlayerId: event.fromPlayerId,
                })
              } catch (cause) {
                console.error("Voice rollback failed", cause)
              }
            }
            await peer.setRemoteDescription({
              type: "offer",
              sdp: event.signal.sdp,
            })
            await syncLocalAudioToPeer(peer, event.fromPlayerId)
            syncRemoteAudioFromPeer(event.fromPlayerId, peer)
            await flushPendingIceCandidates(event.fromPlayerId, peer)
            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            if (!peer.localDescription?.sdp) return
            logRoomVoiceDebug("answer sent", {
              remotePlayerId: event.fromPlayerId,
              signalingState: peer.signalingState,
              localDescriptionType: peer.localDescription.type,
            })
            emitSignal(event.fromPlayerId, {
              type: "answer",
              sdp: peer.localDescription.sdp,
            })
            break
          }
          case "answer":
            if (peer.signalingState !== "have-local-offer") {
              logRoomVoiceDebug("stale answer ignored", {
                remotePlayerId: event.fromPlayerId,
                signalingState: peer.signalingState,
              })
              break
            }
            await peer.setRemoteDescription({
              type: "answer",
              sdp: event.signal.sdp,
            })
            logRoomVoiceDebug("answer applied", {
              remotePlayerId: event.fromPlayerId,
              signalingState: peer.signalingState,
            })
            syncRemoteAudioFromPeer(event.fromPlayerId, peer)
            await flushPendingIceCandidates(event.fromPlayerId, peer)
            break
          case "ice-candidate":
            if (event.signal.candidate) {
              const candidate = event.signal.candidate as RTCIceCandidateInit
              if (peer.remoteDescription) {
                await peer.addIceCandidate(candidate)
                logRoomVoiceDebug("ice candidate applied", {
                  remotePlayerId: event.fromPlayerId,
                  candidate: describeCandidate(candidate),
                })
              } else {
                const pendingCandidates =
                  pendingIceCandidatesRef.current.get(event.fromPlayerId) ?? []
                pendingCandidates.push(candidate)
                pendingIceCandidatesRef.current.set(
                  event.fromPlayerId,
                  pendingCandidates
                )
                logRoomVoiceDebug("ice candidate queued", {
                  remotePlayerId: event.fromPlayerId,
                  candidate: describeCandidate(candidate),
                  pendingCount: pendingCandidates.length,
                })
              }
            }
            break
          case "leave":
            closePeer(event.fromPlayerId)
            break
        }
      } catch (cause) {
        console.error("Voice signal failed", cause)
      }
    },
    [
      closePeer,
      emitSignal,
      ensurePeer,
      flushPendingIceCandidates,
      isPolite,
      syncRemoteAudioFromPeer,
      syncLocalAudioToPeer,
    ]
  )

  useEffect(() => {
    if (!socket) return
    const activeSocket = socket

    function handleVoiceState(event: VoiceStateEvent) {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (event.playerId === activeSelfPlayerId) return

      setVoiceStateForPlayer(event.playerId, {
        enabled: event.enabled,
        muted: event.muted,
        speaking: event.speaking,
      })

      if (!activeSelfPlayerId) return

      if (!event.enabled) {
        closePeer(event.playerId)
        return
      }

      if (enabledRef.current) {
        const peer = ensurePeer(event.playerId)
        if (peer && shouldCreateInitialOffer(event.playerId, peer)) {
          void createOffer(event.playerId)
        }
      }
    }

    function handleSignal(event: VoiceSignalEvent) {
      void handleIncomingSignal(event)
    }

    function handleConnect() {
      if (!enabledRef.current) return
      activeSocket.emit("voice:requestStates")
      emitVoiceState({
        enabled: true,
        muted: mutedRef.current,
        speaking: mutedRef.current ? false : speakingRef.current,
      })
      connectToEnabledPeers()
    }

    function handleDisconnect() {
      closeAllPeers()
    }

    activeSocket.on("voice:state", handleVoiceState)
    activeSocket.on("voice:signal", handleSignal)
    activeSocket.on("connect", handleConnect)
    activeSocket.on("disconnect", handleDisconnect)
    activeSocket.emit("voice:requestStates")

    return () => {
      activeSocket.off("voice:state", handleVoiceState)
      activeSocket.off("voice:signal", handleSignal)
      activeSocket.off("connect", handleConnect)
      activeSocket.off("disconnect", handleDisconnect)
    }
  }, [
    closeAllPeers,
    closePeer,
    connectToEnabledPeers,
    createOffer,
    emitVoiceState,
    ensurePeer,
    handleIncomingSignal,
    setVoiceStateForPlayer,
    shouldCreateInitialOffer,
    socket,
  ])

  useEffect(() => {
    if (!socket || !selfPlayerId) return
    void startListening()
    socket.emit("voice:requestStates")
  }, [selfPlayerId, socket, startListening])

  useEffect(() => {
    const validPlayerIds = new Set(players.map((player) => player.id))
    for (const playerId of peersRef.current.keys()) {
      if (!validPlayerIds.has(playerId)) closePeer(playerId)
    }

    setVoiceStates((current) => {
      let changed = false
      const next: Partial<Record<string, VoicePeerState>> = {}
      for (const [playerId, state] of Object.entries(current)) {
        if (!validPlayerIds.has(playerId)) {
          changed = true
          continue
        }
        if (!state) {
          changed = true
          continue
        }
        next[playerId] = state
      }
      return changed ? next : current
    })
  }, [closePeer, players])

  useEffect(() => {
    if (!selfPlayerId || !socket) stop()
  }, [selfPlayerId, socket, stop])

  useEffect(() => stop, [roomCode, stop])

  useEffect(() => {
    if (typeof window === "undefined") return

    const debugSnapshot = () => {
      return {
        selfPlayerId: selfPlayerIdRef.current,
        enabled: enabledRef.current,
        muted: mutedRef.current,
        speaking: speakingRef.current,
        localTrack: describeTrack(localStreamRef.current?.getAudioTracks()[0]),
        silentTrack: describeTrack(silentAudioSourceRef.current?.track),
        iceServers: (voicePeerConfig.iceServers ?? []).map(
          (server) => server.urls
        ),
        voiceStates: voiceStatesRef.current,
        remoteStreams: Object.fromEntries(
          Object.entries(remoteStreamsByPlayerId).flatMap(
            ([playerId, stream]) =>
              stream
                ? [[playerId, stream.getAudioTracks().map(describeTrack)]]
                : []
          )
        ),
        peers: Object.fromEntries(
          Array.from(peersRef.current.entries()).map(([playerId, peer]) => [
            playerId,
            {
              signalingState: peer.signalingState,
              iceConnectionState: peer.iceConnectionState,
              iceGatheringState: peer.iceGatheringState,
              connectionState: peer.connectionState,
              localDescription: peer.localDescription?.type ?? null,
              remoteDescription: peer.remoteDescription?.type ?? null,
              transceivers: peer.getTransceivers().map((transceiver) => ({
                mid: transceiver.mid,
                direction: transceiver.direction,
                currentDirection: transceiver.currentDirection,
                senderTrack: describeTrack(transceiver.sender.track),
                receiverTrack: describeTrack(transceiver.receiver.track),
              })),
            },
          ])
        ),
      }
    }

    ;(
      window as unknown as { __unoVoiceDebug?: () => unknown }
    ).__unoVoiceDebug = debugSnapshot

    return () => {
      const targetWindow = window as unknown as {
        __unoVoiceDebug?: () => unknown
      }
      if (targetWindow.__unoVoiceDebug === debugSnapshot) {
        delete targetWindow.__unoVoiceDebug
      }
    }
  }, [remoteStreamsByPlayerId])

  const toggle = useCallback(() => {
    if (enabledRef.current && localStreamRef.current) {
      void setLocalMuted(!mutedRef.current)
    } else {
      void start()
    }
  }, [setLocalMuted, start])

  return useMemo(
    () => ({
      enabled,
      connecting,
      muted,
      speaking,
      error,
      voiceStates,
      remoteStreamsByPlayerId,
      toggle,
    }),
    [
      connecting,
      enabled,
      error,
      muted,
      remoteStreamsByPlayerId,
      speaking,
      toggle,
      voiceStates,
    ]
  )
}
