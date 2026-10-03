import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  CommandResult,
  Player,
  VoiceSignal,
  VoiceSignalEvent,
  VoiceStateEvent,
} from "@workspace/game"

import type { GameSocket } from "@/lib/realtime"
import type { VoiceFilterControls } from "@/lib/use-voice-filters"
import { candidateMatchesDescription } from "@/lib/voice-negotiation"

import { getRealtimeUrl } from "@/lib/realtime"
import { useVoiceFilters } from "@/lib/use-voice-filters"
import {
  PEER_DISCONNECT_GRACE_MS,
  PEER_RECONCILE_INTERVAL_MS,
  hasTurnServers,
  isPeerStalled,
  nextRecoveryAction,
} from "@/lib/voice-recovery"

type VoicePeerState = {
  voiceSessionId?: string
  enabled: boolean
  muted: boolean
  speaking: boolean
}

type SilentAudioSource = {
  stream: MediaStream
  track: MediaStreamTrack
  cleanup: () => void
}

export type RoomVoiceController = VoiceFilterControls & {
  enabled: boolean
  connecting: boolean
  muted: boolean
  speaking: boolean
  error: string | null
  voiceStates: Partial<Record<string, VoicePeerState>>
  remoteStreamsByPlayerId: Partial<Record<string, MediaStream>>
  connectionIssues: Record<string, string>
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
  outgoingExchangeId?: string
  remoteExchangeId?: string
  expectedAnswerId?: string
  ignoredExchanges?: Set<string>
  operations?: Promise<void>
  recovering?: boolean
  packetsReceived?: number
  unhealthySince?: number
  statsPending?: boolean
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
let voicePeerConfigLoadedAt = 0
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
  if (
    voicePeerConfigLoadedAt &&
    Date.now() - voicePeerConfigLoadedAt < 5 * 60_000
  )
    return voicePeerConfig.iceServers ?? defaultIceServers

  voicePeerConfigPromise = (async () => {
    const fallbackServers = voicePeerConfig.iceServers ?? defaultIceServers

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 3000)
    try {
      const response = await fetch(`${getRealtimeUrl()}/voice/ice-servers`, {
        cache: "no-store",
        signal: controller.signal,
      })

      if (!response.ok) return fallbackServers

      const payload = (await response.json()) as { iceServers?: unknown }
      const runtimeServers = normalizeVoiceIceServers(payload.iceServers)
      const nextServers =
        hasTurnServers(fallbackServers) && !hasTurnServers(runtimeServers)
          ? fallbackServers
          : runtimeServers.length
            ? runtimeServers
            : fallbackServers

      if (nextServers.length > 0) {
        voicePeerConfig = { iceServers: nextServers }
        if (runtimeServers.length) voicePeerConfigLoadedAt = Date.now()
      }
    } catch (cause) {
      logRoomVoiceDebug("ice server config fetch failed", { cause })
    } finally {
      window.clearTimeout(timeoutId)
    }

    logRoomVoiceDebug("ice server config loaded", {
      iceServers: (voicePeerConfig.iceServers ?? []).map(
        (server) => server.urls
      ),
    })
    return voicePeerConfig.iceServers ?? defaultIceServers
  })()

  try {
    return await voicePeerConfigPromise
  } finally {
    voicePeerConfigPromise = null
  }
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
  joinedSocketId,
  roomCode,
  selfPlayerId,
  players,
}: {
  socket: GameSocket | null
  joinedSocketId: string | null
  roomCode: string
  selfPlayerId: string | null
  players: Array<Player>
}): RoomVoiceController {
  const {
    filter,
    filterError,
    setFilter,
    prepareFilters,
    attachFilters,
    stopFilters,
    muteFilters,
    getFilteredStream,
  } = useVoiceFilters()
  const [enabled, setEnabled] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [connectionIssues, setConnectionIssues] = useState<
    Record<string, string>
  >({})
  const [error, setError] = useState<string | null>(null)
  const [voiceStates, setVoiceStates] = useState<
    Partial<Record<string, VoicePeerState>>
  >({})
  const [remoteStreamsByPlayerId, setRemoteStreamsByPlayerId] = useState<
    Partial<Record<string, MediaStream>>
  >({})

  const socketRef = useRef<GameSocket | null>(socket)
  const joinedSocketIdRef = useRef(joinedSocketId)
  const voiceSessionIdRef = useRef<string | null>(null)
  const lifecycleRef = useRef(0)
  const listeningAttemptRef = useRef<symbol | null>(null)
  const micAttemptRef = useRef<symbol | null>(null)
  const localTrackCleanupRef = useRef<(() => void) | null>(null)
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
    Map<string, Array<{ candidate: RTCIceCandidateInit; exchangeId?: string }>>
  >(new Map())
  const meterCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    joinedSocketIdRef.current = joinedSocketId
  }, [joinedSocketId])

  const canSignal = useCallback(() => {
    const active = socketRef.current
    return Boolean(
      active?.connected &&
      active.id === joinedSocketIdRef.current &&
      voiceSessionIdRef.current
    )
  }, [])

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
          currentState?.voiceSessionId === state.voiceSessionId &&
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

  const emitVoiceState = useCallback(
    (state: VoicePeerState) => {
      const activeSocket = socketRef.current
      if (!activeSocket || !canSignal()) return
      activeSocket.emit("voice:setState", {
        ...state,
        voiceSessionId: voiceSessionIdRef.current!,
      })
    },
    [canSignal]
  )

  const emitSignal = useCallback(
    (targetPlayerId: string, signal: VoiceSignal) => {
      const activeSocket = socketRef.current
      if (!activeSocket || !canSignal()) return
      logRoomVoiceDebug("signal sent", {
        targetPlayerId,
        signal: describeSignal(signal),
      })
      activeSocket.emit("voice:signal", {
        targetPlayerId,
        targetSessionId: voiceStatesRef.current[targetPlayerId]?.voiceSessionId,
        signal,
      })
    },
    [canSignal]
  )

  const clearDisconnectTimer = useCallback((playerId: string) => {
    const meta = peerMetaRef.current.get(playerId)
    if (meta?.disconnectTimerId) {
      window.clearTimeout(meta.disconnectTimerId)
      meta.disconnectTimerId = null
    }
  }, [])

  const setPeerIssue = useCallback(
    (playerId: string, message: string | null) => {
      setConnectionIssues((current) => {
        if (current[playerId] === message || (!message && !current[playerId]))
          return current
        const next = { ...current }
        if (message) next[playerId] = message
        else delete next[playerId]
        return next
      })
    },
    []
  )

  const closePeer = useCallback(
    (playerId: string) => {
      clearDisconnectTimer(playerId)
      setPeerIssue(playerId, null)
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
    [clearDisconnectTimer, setPeerIssue]
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

  const stopLocalStream = useCallback(
    (preservePreparedContext = false) => {
      localTrackCleanupRef.current?.()
      localTrackCleanupRef.current = null
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
      stopFilters(preservePreparedContext)
    },
    [stopFilters]
  )

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
      void audioContext.resume().catch(() => {})

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
      const processedStream = getFilteredStream()
      const processedTrack = processedStream?.getAudioTracks()[0]
      const filtered = processedStream && processedTrack?.readyState === "live"
      return {
        kind: "mic",
        stream: filtered ? processedStream : localStream,
        track: filtered ? processedTrack : localTrack,
      }
    }

    const silentAudioSource = getSilentAudioSource()
    if (!silentAudioSource) return null

    return {
      kind: "silent",
      stream: silentAudioSource.stream,
      track: silentAudioSource.track,
    }
  }, [getFilteredStream, getSilentAudioSource])

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
      if (
        !canSignal() ||
        !activeSelfPlayerId ||
        remotePlayerId === activeSelfPlayerId
      ) {
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
        lastRecoveryAt: previousMeta?.lastRecoveryAt ?? 0,
      })
      logRoomVoiceDebug("peer created", {
        remotePlayerId,
        relayOnly,
        iceServers: voicePeerConfig.iceServers?.map((server) => server.urls),
      })
      void syncLocalAudioToPeer(peer, remotePlayerId).catch((cause) => {
        logRoomVoiceDebug("initial sender sync failed", {
          remotePlayerId,
          cause,
        })
        if (peersRef.current.get(remotePlayerId) === peer)
          recoverPeerRef.current(remotePlayerId, "sender-failed")
      })

      peer.onicecandidate = (event) => {
        if (
          !event.candidate ||
          peersRef.current.get(remotePlayerId) !== peer ||
          !canSignal()
        )
          return
        if (
          !candidateMatchesDescription(
            event.candidate.toJSON(),
            peer.localDescription?.sdp
          )
        )
          return
        logRoomVoiceDebug("ice candidate sent", {
          remotePlayerId,
          candidate: describeCandidate(event.candidate.toJSON()),
        })
        emitSignal(remotePlayerId, {
          type: "ice-candidate",
          exchangeId:
            peerMetaRef.current.get(remotePlayerId)?.outgoingExchangeId,
          candidate: event.candidate.toJSON(),
        })
      }

      peer.ontrack = (event) => {
        logRoomVoiceDebug("ontrack", {
          remotePlayerId,
          track: describeTrack(event.track),
          streamCount: event.streams.length,
        })
        if (peersRef.current.get(remotePlayerId) === peer)
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
          setPeerIssue(remotePlayerId, null)
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
      canSignal,
      clearDisconnectTimer,
      closePeer,
      emitSignal,
      setRemoteAudioTrack,
      setPeerIssue,
      syncLocalAudioToPeer,
    ]
  )

  const queuePeerOperation = useCallback(
    (
      playerId: string,
      peer: RTCPeerConnection,
      operation: () => Promise<void>
    ) => {
      const meta = peerMetaRef.current.get(playerId)
      if (!meta) return Promise.resolve()
      const next = (meta.operations ?? Promise.resolve()).then(async () => {
        if (peersRef.current.get(playerId) === peer && canSignal())
          await operation()
      })
      meta.operations = next.catch(() => {})
      return next
    },
    [canSignal]
  )

  const flushPendingIceCandidates = useCallback(
    async (playerId: string, peer: RTCPeerConnection) => {
      const queued = pendingIceCandidatesRef.current.get(playerId) ?? []
      pendingIceCandidatesRef.current.delete(playerId)
      const meta = peerMetaRef.current.get(playerId)
      for (const item of queued) {
        if (peersRef.current.get(playerId) !== peer) return
        if (item.exchangeId && item.exchangeId !== meta?.remoteExchangeId)
          continue
        if (
          !candidateMatchesDescription(
            item.candidate,
            peer.remoteDescription?.sdp
          )
        )
          continue
        try {
          await peer.addIceCandidate(item.candidate)
        } catch (cause) {
          logRoomVoiceDebug("ice candidate rejected", { playerId, cause })
        }
      }
    },
    []
  )

  const restartNegotiation = useCallback(
    async (playerId: string) => {
      const peer = peersRef.current.get(playerId)
      if (!peer || !canSignal()) return false
      let sent = false
      try {
        await queuePeerOperation(playerId, peer, async () => {
          if (peer.signalingState !== "stable") return
          await syncLocalAudioToPeer(peer, playerId)
          if (peersRef.current.get(playerId) !== peer) return
          const offer = await peer.createOffer({ iceRestart: true })
          if (peersRef.current.get(playerId) !== peer) return
          const meta = peerMetaRef.current.get(playerId)!
          const exchangeId = crypto.randomUUID()
          meta.outgoingExchangeId = exchangeId
          meta.expectedAnswerId = exchangeId
          await peer.setLocalDescription(offer)
          if (
            peersRef.current.get(playerId) !== peer ||
            !canSignal() ||
            !peer.localDescription?.sdp
          )
            return
          emitSignal(playerId, {
            type: "offer",
            sdp: peer.localDescription.sdp,
            exchangeId,
          })
          sent = true
        })
      } catch (cause) {
        logRoomVoiceDebug("ice restart failed", { playerId, cause })
      }
      return sent
    },
    [canSignal, emitSignal, queuePeerOperation, syncLocalAudioToPeer]
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
        await queuePeerOperation(remotePlayerId, peer, async () => {
          await syncLocalAudioToPeer(peer, remotePlayerId)
          if (peersRef.current.get(remotePlayerId) !== peer) return
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
          const meta = peerMetaRef.current.get(remotePlayerId)!
          const exchangeId = crypto.randomUUID()
          meta.outgoingExchangeId = exchangeId
          meta.expectedAnswerId = exchangeId
          await peer.setLocalDescription(offer)
          if (
            peersRef.current.get(remotePlayerId) !== peer ||
            !canSignal() ||
            !peer.localDescription?.sdp
          )
            return
          logRoomVoiceDebug("offer sent", {
            remotePlayerId,
            signalingState: peer.signalingState,
            localDescriptionType: peer.localDescription.type,
          })
          emitSignal(remotePlayerId, {
            type: "offer",
            sdp: peer.localDescription.sdp,
            exchangeId,
          })
        })
      } catch (cause) {
        logRoomVoiceDebug("Voice offer failed", { cause })
      } finally {
        if (peersRef.current.get(remotePlayerId) === peer)
          negotiatingPeersRef.current.delete(remotePlayerId)
      }
    },
    [
      canSignal,
      emitSignal,
      ensurePeer,
      queuePeerOperation,
      shouldCreateInitialOffer,
      syncLocalAudioToPeer,
    ]
  )

  const connectToEnabledPeers = useCallback(() => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId || !enabledRef.current || !canSignal()) return

    for (const player of playersRef.current) {
      if (player.id === activeSelfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue
      const peer = ensurePeer(player.id)
      if (peer && shouldCreateInitialOffer(player.id, peer)) {
        void createOffer(player.id)
      }
    }
  }, [canSignal, createOffer, ensurePeer, shouldCreateInitialOffer])

  /**
   * Repairs one leg of the mesh. First an ICE restart; if the link keeps
   * failing and TURN is configured, the peer is rebuilt as relay-only, which
   * is what gets two players behind unfriendly Wi-Fi NATs talking.
   */
  const recoverPeer = useCallback(
    async (playerId: string, reason: string) => {
      if (
        !enabledRef.current ||
        !canSignal() ||
        !voiceStatesRef.current[playerId]?.enabled
      )
        return
      if (!playersRef.current.some((player) => player.id === playerId)) return
      const peer = peersRef.current.get(playerId)
      const meta = peerMetaRef.current.get(playerId)
      if (
        !peer ||
        !meta ||
        meta.recovering ||
        Date.now() - meta.lastRecoveryAt < RECOVERY_DEBOUNCE_MS
      )
        return
      meta.recovering = true
      meta.lastRecoveryAt = Date.now()
      const name =
        playersRef.current.find((player) => player.id === playerId)?.name ??
        "player"
      setPeerIssue(playerId, `Reconnecting voice with ${name}…`)
      try {
        await loadVoicePeerConfig()
        if (peersRef.current.get(playerId) !== peer || !canSignal()) return
        const action = nextRecoveryAction({
          restartAttempts: meta.restartAttempts,
          relayOnly: meta.relayOnly,
          turnAvailable: hasTurnServers(voicePeerConfig.iceServers),
        })
        logRoomVoiceDebug("peer recovery", { playerId, reason, action })
        // An unanswered offer cannot be restarted in place. Rebuild it now instead of spending empty retries.
        if (
          action === "ice-restart" &&
          peer.signalingState === "stable" &&
          reason !== "sender-failed" &&
          reason !== "media-ended"
        ) {
          peer.setConfiguration({
            ...voicePeerConfig,
            iceTransportPolicy: meta.relayOnly ? "relay" : "all",
          })
          if (await restartNegotiation(playerId)) {
            if (peersRef.current.get(playerId) !== peer) return
            meta.restartAttempts += 1
            meta.createdAt = Date.now()
            meta.connectedAt = null
            return
          }
        }
        if (peersRef.current.get(playerId) !== peer || !canSignal()) return
        closePeer(playerId)
        peerMetaRef.current.set(playerId, {
          relayOnly: meta.relayOnly || action === "rebuild-relay",
          restartAttempts: action === "ice-restart" ? meta.restartAttempts : 0,
          createdAt: Date.now(),
          connectedAt: null,
          disconnectTimerId: null,
          lastRecoveryAt: Date.now(),
        })
        const rebuilt = ensurePeer(playerId)
        setPeerIssue(playerId, `Reconnecting voice with ${name}…`)
        if (rebuilt && (await restartNegotiation(playerId))) {
          const nextMeta = peerMetaRef.current.get(playerId)
          if (nextMeta && peersRef.current.get(playerId) === rebuilt)
            nextMeta.restartAttempts += 1
        }
      } catch (cause) {
        logRoomVoiceDebug("peer recovery failed", { playerId, cause })
      } finally {
        meta.recovering = false
      }
    },
    [canSignal, closePeer, ensurePeer, restartNegotiation, setPeerIssue]
  )

  useEffect(() => {
    recoverPeerRef.current = recoverPeer
  }, [recoverPeer])

  const checkPeerMedia = useCallback(
    async (playerId: string, peer: RTCPeerConnection) => {
      const meta = peerMetaRef.current.get(playerId)
      if (!meta || meta.statsPending) return
      const tracks = peer
        .getReceivers()
        .filter((receiver) => receiver.track.kind === "audio")
        .map((receiver) => receiver.track)
      if (tracks.some((track) => track.readyState === "ended")) {
        void recoverPeer(playerId, "media-ended")
        return
      }
      // Packet silence is only a fault while the remote mic reports active speech.
      // Muted listeners and silence suppression must not trigger repair loops.
      const state = voiceStatesRef.current[playerId]
      if (
        !state?.speaking ||
        state.muted ||
        typeof peer.getStats !== "function"
      ) {
        meta.unhealthySince = undefined
        return
      }
      meta.statsPending = true
      try {
        const stats = await peer.getStats()
        if (peersRef.current.get(playerId) !== peer || !canSignal()) return
        let packets = 0
        stats.forEach((report) => {
          if (
            report.type === "inbound-rtp" &&
            (report.kind === "audio" || report.mediaType === "audio")
          )
            packets += report.packetsReceived ?? 0
        })
        if (
          meta.packetsReceived === undefined ||
          packets > meta.packetsReceived
        ) {
          meta.unhealthySince = undefined
          setPeerIssue(playerId, null)
        } else {
          meta.unhealthySince ??= Date.now()
          if (Date.now() - meta.unhealthySince >= 15_000) {
            meta.unhealthySince = undefined
            void recoverPeer(playerId, "media-stalled")
          }
        }
        meta.packetsReceived = packets
      } catch (cause) {
        logRoomVoiceDebug("media stats unavailable", { playerId, cause })
      } finally {
        meta.statsPending = false
      }
    },
    [canSignal, recoverPeer, setPeerIssue]
  )

  /**
   * Watchdog for the silent failures: a peer that never finished connecting,
   * or a remote player who is on voice but has no peer at all on this side.
   */
  const reconcileMesh = useCallback(() => {
    const activeSelfPlayerId = selfPlayerIdRef.current
    if (!activeSelfPlayerId || !enabledRef.current || !canSignal()) return

    const now = Date.now()
    for (const player of playersRef.current) {
      if (player.id === activeSelfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue

      const peer = peersRef.current.get(player.id)
      if (!peer) {
        const created = ensurePeer(player.id)
        if (created && shouldCreateInitialOffer(player.id, created)) {
          void createOffer(player.id)
        }
        continue
      }

      if (peer.connectionState === "connected") {
        void checkPeerMedia(player.id, peer)
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

      void recoverPeer(player.id, `stalled-${peer.connectionState}`)
    }
  }, [
    canSignal,
    checkPeerMedia,
    createOffer,
    ensurePeer,
    recoverPeer,
    shouldCreateInitialOffer,
  ])

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
      tasks.push(
        syncLocalAudioToPeer(peer, playerId).catch((cause) => {
          if (peersRef.current.get(playerId) !== peer) return
          logRoomVoiceDebug("sender sync failed", { playerId, cause })
          recoverPeerRef.current(playerId, "sender-failed")
        })
      )
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

  const stop = useCallback(() => {
    lifecycleRef.current += 1
    listeningAttemptRef.current = null
    micAttemptRef.current = null
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
    voiceSessionIdRef.current = null
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

  const startListening = useCallback(async () => {
    const activeSocket = socketRef.current
    const selfId = selfPlayerIdRef.current
    if (
      !selfId ||
      !activeSocket?.connected ||
      activeSocket.id !== joinedSocketIdRef.current
    )
      return false
    if (canSignal()) return true
    if (listeningAttemptRef.current) return false
    const token = Symbol()
    const lifecycle = lifecycleRef.current
    const socketId = activeSocket.id
    const isCurrent = () =>
      lifecycle === lifecycleRef.current &&
      activeSocket.connected &&
      activeSocket.id === socketId
    listeningAttemptRef.current = token
    setConnecting(true)
    setError(null)
    try {
      await loadVoicePeerConfig()
      if (!isCurrent()) return false
      const result = await new Promise<
        CommandResult<{
          sessionId: string
          states: Array<VoiceStateEvent>
        }>
      >((resolve, reject) => {
        activeSocket
          .timeout(5_000)
          .emit("voice:join", (cause: Error | null, response) =>
            cause ? reject(cause) : resolve(response)
          )
      })
      if (!isCurrent()) {
        if (
          result.ok &&
          Boolean(activeSocket.connected) &&
          activeSocket.id === socketId
        ) {
          activeSocket.emit("voice:setState", {
            enabled: false,
            muted: true,
            speaking: false,
            voiceSessionId: result.data.sessionId,
          })
        }
        return false
      }
      if (!result.ok) {
        stop()
        setError(result.error.message)
        return false
      }
      voiceSessionIdRef.current = result.data.sessionId
      const states = Object.fromEntries(
        result.data.states
          .filter((state) => state.enabled)
          .map((state) => [state.playerId, state])
      )
      voiceStatesRef.current = states
      setVoiceStates(states)
      enabledRef.current = true
      setEnabled(true)
      publishLocalVoiceState({
        enabled: true,
        muted: mutedRef.current,
        speaking: speakingRef.current,
      })
      connectToEnabledPeers()
      return true
    } catch (cause) {
      if (lifecycle === lifecycleRef.current) {
        stop()
        setError("Could not join voice. Tap the mic to retry.")
      }
      logRoomVoiceDebug("voice join failed", { cause })
      return false
    } finally {
      if (listeningAttemptRef.current === token) {
        listeningAttemptRef.current = null
        setConnecting(false)
      }
    }
  }, [canSignal, connectToEnabledPeers, publishLocalVoiceState, stop])

  const setLocalMuted = useCallback(
    async (nextMuted: boolean) => {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (!activeSelfPlayerId || !enabledRef.current || !localStreamRef.current)
        return

      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted
      }
      muteFilters(nextMuted)

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
    [muteFilters, publishLocalVoiceState, syncAllPeers]
  )

  const startSpeakingMeter = useCallback(
    (stream: MediaStream) => {
      stopSpeakingMeter()

      const AudioContextClass = getBrowserAudioContext()
      if (!AudioContextClass) return

      const audioContext = new AudioContextClass()
      void audioContext.resume().catch(() => {})
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
    if (
      !selfPlayerIdRef.current ||
      micAttemptRef.current ||
      listeningAttemptRef.current
    )
      return
    if (!canSignal() && !(await startListening())) return
    if (!canSignal() || !selfPlayerIdRef.current) return
    if (
      localStreamRef.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    ) {
      await setLocalMuted(false)
      return
    }
    stopLocalStream(true)
    const mediaDevices = (
      navigator as {
        mediaDevices?: { getUserMedia?: MediaDevices["getUserMedia"] }
      }
    ).mediaDevices
    if (!mediaDevices?.getUserMedia) {
      stopFilters()
      setError("Voice chat is not available in this browser.")
      return
    }
    const token = Symbol()
    const lifecycle = lifecycleRef.current
    micAttemptRef.current = token
    setConnecting(true)
    setError(null)
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
      if (lifecycle !== lifecycleRef.current || !canSignal()) {
        stream.getTracks().forEach((audioTrack) => audioTrack.stop())
        return
      }
      const track = stream
        .getAudioTracks()
        .find((audioTrack) => audioTrack.readyState === "live")
      if (!track) {
        stream.getTracks().forEach((audioTrack) => audioTrack.stop())
        throw new Error("No live microphone")
      }
      // Keep capture gated while the processor loads; mesh repair may run
      // during this await and must not send an unfiltered mic in the meantime.
      track.enabled = false
      localStreamRef.current = stream
      const ended = () => {
        if (localStreamRef.current !== stream) return
        stopSpeakingMeter()
        stopLocalStream()
        mutedRef.current = true
        setMuted(true)
        publishLocalVoiceState({ enabled: true, muted: true, speaking: false })
        setError("Microphone stopped. Tap the mic to reconnect it.")
        void syncAllPeers()
      }
      track.addEventListener("ended", ended)
      localTrackCleanupRef.current = () =>
        track.removeEventListener("ended", ended)
      await attachFilters(stream)
      if (
        lifecycle !== lifecycleRef.current ||
        !canSignal() ||
        localStreamRef.current !== stream ||
        track.readyState !== "live"
      ) {
        if (localStreamRef.current === stream) stopLocalStream()
        return
      }
      track.enabled = true
      muteFilters(false)
      mutedRef.current = false
      speakingRef.current = false
      setMuted(false)
      setSpeaking(false)
      // A missing volume meter must never tear down a working microphone.
      try {
        startSpeakingMeter(stream)
      } catch (cause) {
        logRoomVoiceDebug("speaking meter unavailable", { cause })
      }
      await syncAllPeers()
      if (lifecycle !== lifecycleRef.current) return
      publishLocalVoiceState({ enabled: true, muted: false, speaking: false })
      connectToEnabledPeers()
    } catch (cause) {
      if (lifecycle !== lifecycleRef.current) return
      stopLocalStream()
      mutedRef.current = true
      setMuted(true)
      publishLocalVoiceState({ enabled: true, muted: true, speaking: false })
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Mic permission was blocked."
          : "Could not start the microphone. Tap to retry."
      )
    } finally {
      if (micAttemptRef.current === token) {
        micAttemptRef.current = null
        setConnecting(false)
      }
    }
  }, [
    attachFilters,
    canSignal,
    connectToEnabledPeers,
    publishLocalVoiceState,
    setLocalMuted,
    startListening,
    startSpeakingMeter,
    stopFilters,
    stopLocalStream,
    stopSpeakingMeter,
    syncAllPeers,
    muteFilters,
  ])

  const handleIncomingSignal = useCallback(
    async (event: VoiceSignalEvent) => {
      const selfId = selfPlayerIdRef.current
      const playerId = event.fromPlayerId
      const remote = voiceStatesRef.current[playerId]
      if (
        !selfId ||
        event.targetPlayerId !== selfId ||
        playerId === selfId ||
        !enabledRef.current ||
        !canSignal()
      )
        return
      if (
        !playersRef.current.some((player) => player.id === playerId) ||
        !remote?.enabled
      )
        return
      if (
        event.targetSessionId &&
        event.targetSessionId !== voiceSessionIdRef.current
      )
        return
      if (event.fromSessionId && event.fromSessionId !== remote.voiceSessionId)
        return
      if (event.signal.type === "leave") {
        closePeer(playerId)
        return
      }
      const peer = ensurePeer(playerId)
      if (!peer) return
      const signal = event.signal
      const current = () =>
        peersRef.current.get(playerId) === peer && canSignal()
      try {
        await queuePeerOperation(playerId, peer, async () => {
          const meta = peerMetaRef.current.get(playerId)!
          if (signal.type === "offer") {
            if (peer.signalingState !== "stable" && !isPolite(playerId)) {
              if (signal.exchangeId) {
                meta.ignoredExchanges ??= new Set()
                meta.ignoredExchanges.add(signal.exchangeId)
                if (meta.ignoredExchanges.size > 16)
                  meta.ignoredExchanges.delete(
                    meta.ignoredExchanges.values().next().value!
                  )
              }
              return
            }
            if (peer.signalingState !== "stable")
              await peer.setLocalDescription({ type: "rollback" })
            if (!current()) return
            await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp })
            if (!current()) return
            meta.remoteExchangeId = signal.exchangeId
            meta.expectedAnswerId = undefined
            await syncLocalAudioToPeer(peer, playerId)
            if (!current()) return
            syncRemoteAudioFromPeer(playerId, peer)
            await flushPendingIceCandidates(playerId, peer)
            if (!current()) return
            const answer = await peer.createAnswer()
            if (!current()) return
            meta.outgoingExchangeId = signal.exchangeId
            await peer.setLocalDescription(answer)
            if (current() && peer.localDescription?.sdp)
              emitSignal(playerId, {
                type: "answer",
                sdp: peer.localDescription.sdp,
                exchangeId: signal.exchangeId,
              })
          } else if (signal.type === "answer") {
            if (peer.signalingState !== "have-local-offer") return
            if (
              signal.exchangeId &&
              signal.exchangeId !== meta.expectedAnswerId
            )
              return
            await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp })
            if (!current()) return
            meta.remoteExchangeId = signal.exchangeId
            meta.expectedAnswerId = undefined
            syncRemoteAudioFromPeer(playerId, peer)
            await flushPendingIceCandidates(playerId, peer)
          } else if (signal.candidate) {
            if (
              signal.exchangeId &&
              meta.ignoredExchanges?.has(signal.exchangeId)
            )
              return
            const candidate = signal.candidate as RTCIceCandidateInit
            const matches =
              (!signal.exchangeId ||
                signal.exchangeId === meta.remoteExchangeId) &&
              candidateMatchesDescription(
                candidate,
                peer.remoteDescription?.sdp
              )
            if (peer.remoteDescription && matches) {
              try {
                await peer.addIceCandidate(candidate)
              } catch (cause) {
                logRoomVoiceDebug("ice candidate rejected", { playerId, cause })
              }
            } else {
              const queued = pendingIceCandidatesRef.current.get(playerId) ?? []
              queued.push({ candidate, exchangeId: signal.exchangeId })
              pendingIceCandidatesRef.current.set(playerId, queued.slice(-64))
            }
          }
        })
      } catch (cause) {
        logRoomVoiceDebug("voice signal failed", { playerId, cause })
        if (current()) recoverPeerRef.current(playerId, "signal-failed")
      }
    },
    [
      canSignal,
      closePeer,
      emitSignal,
      ensurePeer,
      flushPendingIceCandidates,
      isPolite,
      queuePeerOperation,
      syncLocalAudioToPeer,
      syncRemoteAudioFromPeer,
    ]
  )

  useEffect(() => {
    if (!socket) return
    const activeSocket = socket

    function handleVoiceState(event: VoiceStateEvent) {
      const activeSelfPlayerId = selfPlayerIdRef.current
      if (event.playerId === activeSelfPlayerId) return

      const previous = voiceStatesRef.current[event.playerId]
      if (
        !event.enabled &&
        event.voiceSessionId &&
        previous?.voiceSessionId &&
        event.voiceSessionId !== previous.voiceSessionId
      )
        return
      if (previous?.voiceSessionId !== event.voiceSessionId)
        closePeer(event.playerId)
      voiceStatesRef.current = {
        ...voiceStatesRef.current,
        [event.playerId]: event,
      }
      setVoiceStateForPlayer(event.playerId, {
        voiceSessionId: event.voiceSessionId,
        enabled: event.enabled,
        muted: event.muted,
        speaking: event.speaking,
      })

      if (!activeSelfPlayerId) return

      if (!event.enabled) {
        closePeer(event.playerId)
        return
      }

      if (enabledRef.current && canSignal()) {
        const peer = ensurePeer(event.playerId)
        if (peer && shouldCreateInitialOffer(event.playerId, peer)) {
          void createOffer(event.playerId)
        }
      }
    }

    function handleSignal(event: VoiceSignalEvent) {
      void handleIncomingSignal(event)
    }

    function handleDisconnect() {
      lifecycleRef.current += 1
      listeningAttemptRef.current = null
      micAttemptRef.current = null
      voiceSessionIdRef.current = null
      joinedSocketIdRef.current = null
      setConnecting(false)
      closeAllPeers()
      voiceStatesRef.current = {}
      setVoiceStates({})
    }
    function handleUnavailable(nextError: { message: string }) {
      stop()
      setError(nextError.message)
    }

    activeSocket.on("voice:state", handleVoiceState)
    activeSocket.on("voice:signal", handleSignal)
    activeSocket.on("voice:unavailable", handleUnavailable)
    activeSocket.on("disconnect", handleDisconnect)

    return () => {
      activeSocket.off("voice:state", handleVoiceState)
      activeSocket.off("voice:signal", handleSignal)
      activeSocket.off("voice:unavailable", handleUnavailable)
      activeSocket.off("disconnect", handleDisconnect)
    }
  }, [
    canSignal,
    stop,
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
    if (
      !socket ||
      !selfPlayerId ||
      !joinedSocketId ||
      joinedSocketId !== socket.id
    )
      return
    void startListening()
  }, [joinedSocketId, selfPlayerId, socket, startListening])

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

  useEffect(() => stop, [roomCode, selfPlayerId, stop])

  useEffect(() => {
    if (typeof window === "undefined") return

    const debugSnapshot = () => {
      return {
        selfPlayerId: selfPlayerIdRef.current,
        voiceSessionId: voiceSessionIdRef.current,
        roomJoined: socketRef.current?.id === joinedSocketIdRef.current,
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
              relayOnly: peerMetaRef.current.get(playerId)?.relayOnly,
              restartAttempts:
                peerMetaRef.current.get(playerId)?.restartAttempts,
              packetsReceived:
                peerMetaRef.current.get(playerId)?.packetsReceived,
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
    if (mutedRef.current) prepareFilters()
    if (
      canSignal() &&
      enabledRef.current &&
      localStreamRef.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    ) {
      void setLocalMuted(!mutedRef.current)
    } else {
      void start()
    }
  }, [canSignal, prepareFilters, setLocalMuted, start])

  return useMemo(
    () => ({
      enabled,
      connecting,
      muted,
      speaking,
      error,
      filter,
      filterError,
      setFilter,
      voiceStates,
      remoteStreamsByPlayerId,
      connectionIssues,
      toggle,
    }),
    [
      connectionIssues,
      connecting,
      enabled,
      error,
      filter,
      filterError,
      setFilter,
      muted,
      remoteStreamsByPlayerId,
      speaking,
      toggle,
      voiceStates,
    ]
  )
}
