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
  speaking: boolean
}

export type RoomVoiceController = {
  enabled: boolean
  connecting: boolean
  speaking: boolean
  error: string | null
  voiceStates: Record<string, VoicePeerState>
  remoteStreamsByPlayerId: Record<string, MediaStream>
  toggle: () => void
}

const voicePeerConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceStates, setVoiceStates] = useState<Record<string, VoicePeerState>>({})
  const [remoteStreamsByPlayerId, setRemoteStreamsByPlayerId] = useState<
    Record<string, MediaStream>
  >({})

  const socketRef = useRef<GameSocket | null>(socket)
  const selfPlayerIdRef = useRef<string | null>(selfPlayerId)
  const playersRef = useRef<Player[]>(players)
  const enabledRef = useRef(enabled)
  const speakingRef = useRef(speaking)
  const voiceStatesRef = useRef(voiceStates)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const offeredPeersRef = useRef<Set<string>>(new Set())
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
    [],
  )

  const emitVoiceState = useCallback((state: VoicePeerState) => {
    const socket = socketRef.current
    if (!socket) return
    socket.emit("voice:setState", state)
  }, [])

  const emitSignal = useCallback((targetPlayerId: string, signal: VoiceSignal) => {
    const socket = socketRef.current
    if (!socket) return
    socket.emit("voice:signal", { targetPlayerId, signal })
  }, [])

  const closePeer = useCallback((playerId: string) => {
    const peer = peersRef.current.get(playerId)
    if (peer) {
      peer.onicecandidate = null
      peer.ontrack = null
      peer.onconnectionstatechange = null
      peer.close()
    }

    peersRef.current.delete(playerId)
    offeredPeersRef.current.delete(playerId)
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

  const shouldCreateOffer = useCallback((remotePlayerId: string) => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId) return false
    return selfPlayerId < remotePlayerId
  }, [])

  const ensurePeer = useCallback(
    (remotePlayerId: string) => {
      const selfPlayerId = selfPlayerIdRef.current
      const localStream = localStreamRef.current
      if (!selfPlayerId || !localStream || remotePlayerId === selfPlayerId) {
        return null
      }

      const existingPeer = peersRef.current.get(remotePlayerId)
      if (existingPeer) return existingPeer

      const peer = new RTCPeerConnection(voicePeerConfig)
      for (const track of localStream.getAudioTracks()) {
        peer.addTrack(track, localStream)
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        emitSignal(remotePlayerId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        })
      }

      peer.ontrack = (event) => {
        const [stream] = event.streams
        if (!stream) return
        setRemoteStreamsByPlayerId((current) =>
          current[remotePlayerId] === stream
            ? current
            : { ...current, [remotePlayerId]: stream },
        )
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          closePeer(remotePlayerId)
        }
      }

      peersRef.current.set(remotePlayerId, peer)
      return peer
    },
    [closePeer, emitSignal],
  )

  const createOffer = useCallback(
    async (remotePlayerId: string) => {
      if (offeredPeersRef.current.has(remotePlayerId)) return
      const peer = ensurePeer(remotePlayerId)
      if (!peer || peer.signalingState !== "stable") return

      offeredPeersRef.current.add(remotePlayerId)
      try {
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        if (!peer.localDescription?.sdp) return
        emitSignal(remotePlayerId, {
          type: "offer",
          sdp: peer.localDescription.sdp,
        })
      } catch (cause) {
        offeredPeersRef.current.delete(remotePlayerId)
        console.error("Voice offer failed", cause)
      }
    },
    [emitSignal, ensurePeer],
  )

  const connectToEnabledPeers = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || !enabledRef.current) return

    for (const player of playersRef.current) {
      if (player.id === selfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue
      ensurePeer(player.id)
      if (shouldCreateOffer(player.id)) void createOffer(player.id)
    }
  }, [createOffer, ensurePeer, shouldCreateOffer])

  const stop = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
    setConnecting(false)
    setEnabled(false)
    enabledRef.current = false
    stopSpeakingMeter()
    stopLocalStream()
    closeAllPeers()
    emitVoiceState({ enabled: false, speaking: false })
    if (selfPlayerId) {
      setVoiceStateForPlayer(selfPlayerId, { enabled: false, speaking: false })
    }
  }, [
    closeAllPeers,
    emitVoiceState,
    setVoiceStateForPlayer,
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
        const state = { enabled: true, speaking: nextSpeaking }
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
    [emitVoiceState, setVoiceStateForPlayer, stopSpeakingMeter],
  )

  const start = useCallback(async () => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || enabledRef.current || connecting) return
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

      localStreamRef.current = stream
      enabledRef.current = true
      setEnabled(true)
      const state = { enabled: true, speaking: false }
      setVoiceStateForPlayer(selfPlayerId, state)
      emitVoiceState(state)
      startSpeakingMeter(stream)
      connectToEnabledPeers()
    } catch (cause) {
      stopLocalStream()
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Mic permission was blocked."
          : "Could not start voice chat.",
      )
    } finally {
      setConnecting(false)
    }
  }, [
    connectToEnabledPeers,
    connecting,
    emitVoiceState,
    setVoiceStateForPlayer,
    startSpeakingMeter,
    stopLocalStream,
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
        switch (event.signal.type) {
          case "offer": {
            await peer.setRemoteDescription({
              type: "offer",
              sdp: event.signal.sdp,
            })
            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            if (!peer.localDescription?.sdp) return
            emitSignal(event.fromPlayerId, {
              type: "answer",
              sdp: peer.localDescription.sdp,
            })
            break
          }
          case "answer":
            if (peer.signalingState !== "stable") {
              await peer.setRemoteDescription({
                type: "answer",
                sdp: event.signal.sdp,
              })
            }
            break
          case "ice-candidate":
            if (event.signal.candidate) {
              await peer.addIceCandidate(
                event.signal.candidate as RTCIceCandidateInit,
              )
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
    [closePeer, emitSignal, ensurePeer],
  )

  useEffect(() => {
    if (!socket) return

    function handleVoiceState(event: VoiceStateEvent) {
      setVoiceStateForPlayer(event.playerId, {
        enabled: event.enabled,
        speaking: event.speaking,
      })

      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId || event.playerId === selfPlayerId) return

      if (!event.enabled) {
        closePeer(event.playerId)
        return
      }

      if (enabledRef.current) {
        ensurePeer(event.playerId)
        if (shouldCreateOffer(event.playerId)) void createOffer(event.playerId)
      }
    }

    function handleSignal(event: VoiceSignalEvent) {
      void handleIncomingSignal(event)
    }

    function handleConnect() {
      if (!enabledRef.current) return
      emitVoiceState({ enabled: true, speaking: speakingRef.current })
      connectToEnabledPeers()
    }

    function handleDisconnect() {
      closeAllPeers()
    }

    socket.on("voice:state", handleVoiceState)
    socket.on("voice:signal", handleSignal)
    socket.on("connect", handleConnect)
    socket.on("disconnect", handleDisconnect)

    return () => {
      socket.off("voice:state", handleVoiceState)
      socket.off("voice:signal", handleSignal)
      socket.off("connect", handleConnect)
      socket.off("disconnect", handleDisconnect)
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
    shouldCreateOffer,
    socket,
  ])

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

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      stop()
    } else {
      void start()
    }
  }, [start, stop])

  return useMemo(
    () => ({
      enabled,
      connecting,
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
      remoteStreamsByPlayerId,
      speaking,
      toggle,
      voiceStates,
    ],
  )
}
