import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  Player,
  VoiceSignal,
  VoiceSignalEvent,
  VoiceStateEvent,
} from "@workspace/game"

import type { GameSocket } from "@/lib/realtime"

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
  voiceStates: Record<string, VoicePeerState>
  remoteStreamsByPlayerId: Record<string, MediaStream>
  toggle: () => void
}

const defaultIceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
]

function getVoiceIceServers(): RTCIceServer[] {
  const configuredServers = import.meta.env.VITE_RTC_ICE_SERVERS?.trim()
  if (!configuredServers) return defaultIceServers

  try {
    const parsedServers = JSON.parse(configuredServers) as RTCIceServer[]
    return Array.isArray(parsedServers) && parsedServers.length > 0
      ? parsedServers
      : defaultIceServers
  } catch (cause) {
    console.error("Invalid VITE_RTC_ICE_SERVERS value", cause)
    return defaultIceServers
  }
}

const voicePeerConfig: RTCConfiguration = {
  iceServers: getVoiceIceServers(),
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
  players: Player[]
}): RoomVoiceController {
  const [enabled, setEnabled] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceStates, setVoiceStates] = useState<
    Record<string, VoicePeerState>
  >({})
  const [remoteStreamsByPlayerId, setRemoteStreamsByPlayerId] = useState<
    Record<string, MediaStream>
  >({})

  const socketRef = useRef<GameSocket | null>(socket)
  const selfPlayerIdRef = useRef<string | null>(selfPlayerId)
  const playersRef = useRef<Player[]>(players)
  const enabledRef = useRef(enabled)
  const mutedRef = useRef(muted)
  const speakingRef = useRef(speaking)
  const voiceStatesRef = useRef(voiceStates)
  const localStreamRef = useRef<MediaStream | null>(null)
  const silentAudioSourceRef = useRef<SilentAudioSource | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const negotiatingPeersRef = useRef<Set<string>>(new Set())
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map()
  )
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
    const socket = socketRef.current
    if (!socket) return
    socket.emit("voice:setState", state)
  }, [])

  const emitSignal = useCallback(
    (targetPlayerId: string, signal: VoiceSignal) => {
      const socket = socketRef.current
      if (!socket) return
      logRoomVoiceDebug("signal sent", {
        targetPlayerId,
        signal: describeSignal(signal),
      })
      socket.emit("voice:signal", { targetPlayerId, signal })
    },
    []
  )

  const closePeer = useCallback((playerId: string) => {
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
  }, [])

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

    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
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

      const track = destination.stream.getAudioTracks()[0]
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

  const shouldCreateOffer = useCallback((remotePlayerId: string) => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId) return false
    return selfPlayerId < remotePlayerId
  }, [])

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
        if (receiver.track?.kind === "audio") {
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
            transceiver.receiver.track?.kind === "audio"
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
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId || remotePlayerId === selfPlayerId) {
        return null
      }

      const existingPeer = peersRef.current.get(remotePlayerId)
      if (existingPeer) return existingPeer

      const peer = new RTCPeerConnection(voicePeerConfig)
      logRoomVoiceDebug("peer created", {
        remotePlayerId,
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
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        ) {
          closePeer(remotePlayerId)
        }
      }

      peer.oniceconnectionstatechange = () => {
        logRoomVoiceDebug("ice state changed", {
          remotePlayerId,
          iceConnectionState: peer.iceConnectionState,
          connectionState: peer.connectionState,
        })
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
    [closePeer, emitSignal, setRemoteAudioTrack, syncLocalAudioToPeer]
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
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || !enabledRef.current) return

    for (const player of playersRef.current) {
      if (player.id === selfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue
      const peer = ensurePeer(player.id)
      if (peer && shouldCreateInitialOffer(player.id, peer)) {
        void createOffer(player.id)
      }
    }
  }, [createOffer, ensurePeer, shouldCreateInitialOffer])

  const syncAllPeers = useCallback(async () => {
    const tasks: Promise<void>[] = []
    for (const [playerId, peer] of peersRef.current) {
      tasks.push(syncLocalAudioToPeer(peer, playerId))
    }
    await Promise.all(tasks)
  }, [syncLocalAudioToPeer])

  const publishLocalVoiceState = useCallback(
    (state: VoicePeerState) => {
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId) return
      setVoiceStateForPlayer(selfPlayerId, state)
      emitVoiceState(state)
    },
    [emitVoiceState, setVoiceStateForPlayer]
  )

  const startListening = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || enabledRef.current) return

    enabledRef.current = true
    mutedRef.current = true
    speakingRef.current = false
    setEnabled(true)
    setMuted(true)
    setSpeaking(false)
    publishLocalVoiceState({ enabled: true, muted: true, speaking: false })
    logRoomVoiceDebug("joined voice as listener", { selfPlayerId })
    socketRef.current?.emit("voice:requestStates")
    connectToEnabledPeers()
  }, [connectToEnabledPeers, publishLocalVoiceState])

  const setLocalMuted = useCallback(
    async (nextMuted: boolean) => {
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId || !enabledRef.current || !localStreamRef.current)
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
        selfPlayerId,
        muted: nextMuted,
        localTrack: describeTrack(localStreamRef.current.getAudioTracks()[0]),
      })
      await syncAllPeers()
    },
    [publishLocalVoiceState, syncAllPeers]
  )

  const stop = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
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
    if (selfPlayerId) {
      setVoiceStateForPlayer(selfPlayerId, {
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

      const AudioContextClass =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
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
        const selfPlayerId = selfPlayerIdRef.current
        if (!selfPlayerId || !enabledRef.current) return

        if (mutedRef.current) {
          if (!lastSpeaking) return
          lastSpeaking = false
          speakingRef.current = false
          setSpeaking(false)
          const state = { enabled: true, muted: true, speaking: false }
          setVoiceStateForPlayer(selfPlayerId, state)
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
        setVoiceStateForPlayer(selfPlayerId, state)
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
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || connecting) return
    if (localStreamRef.current) {
      await setLocalMuted(false)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice chat is not available in this browser.")
      return
    }

    setConnecting(true)
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
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
        selfPlayerId,
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
      const selfPlayerId = selfPlayerIdRef.current
      if (
        !selfPlayerId ||
        event.targetPlayerId !== selfPlayerId ||
        event.fromPlayerId === selfPlayerId ||
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
      syncRemoteAudioFromPeer,
      syncLocalAudioToPeer,
    ]
  )

  useEffect(() => {
    if (!socket) return
    const activeSocket = socket

    function handleVoiceState(event: VoiceStateEvent) {
      const selfPlayerId = selfPlayerIdRef.current
      if (event.playerId === selfPlayerId) return

      setVoiceStateForPlayer(event.playerId, {
        enabled: event.enabled,
        muted: event.muted,
        speaking: event.speaking,
      })

      if (!selfPlayerId) return

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
    startListening()
    socket.emit("voice:requestStates")
  }, [selfPlayerId, socket, startListening])

  useEffect(() => {
    const validPlayerIds = new Set(players.map((player) => player.id))
    for (const playerId of peersRef.current.keys()) {
      if (!validPlayerIds.has(playerId)) closePeer(playerId)
    }

    setVoiceStates((current) => {
      let changed = false
      const next: Record<string, VoicePeerState> = {}
      for (const [playerId, state] of Object.entries(current)) {
        if (!validPlayerIds.has(playerId)) {
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
        voiceStates: voiceStatesRef.current,
        remoteStreams: Object.fromEntries(
          Object.entries(remoteStreamsByPlayerId).map(([playerId, stream]) => [
            playerId,
            stream.getAudioTracks().map(describeTrack),
          ])
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
