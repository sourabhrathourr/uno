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
  const [muted, setMuted] = useState(true)
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
  const mutedRef = useRef(muted)
  const speakingRef = useRef(speaking)
  const voiceStatesRef = useRef(voiceStates)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const negotiatingPeersRef = useRef<Set<string>>(new Set())
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
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

  const shouldCreateOffer = useCallback((remotePlayerId: string) => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId) return false
    return selfPlayerId < remotePlayerId
  }, [])

  const syncLocalAudioToPeer = useCallback(async (peer: RTCPeerConnection) => {
    const localStream = localStreamRef.current
    const localTrack = localStream?.getAudioTracks()[0] ?? null
    const audioTransceiver = peer
      .getTransceivers()
      .find(
        (transceiver) =>
          transceiver.sender.track?.kind === "audio" ||
          transceiver.receiver.track?.kind === "audio",
      )

    if (localTrack && localStream) {
      if (audioTransceiver) {
        if (audioTransceiver.sender.track !== localTrack) {
          await audioTransceiver.sender.replaceTrack(localTrack)
        }
        if (audioTransceiver.direction !== "sendrecv") {
          audioTransceiver.direction = "sendrecv"
        }
      } else {
        peer.addTrack(localTrack, localStream)
      }
      return
    }

    if (audioTransceiver) {
      if (audioTransceiver.sender.track) {
        await audioTransceiver.sender.replaceTrack(null)
      }
      if (
        audioTransceiver.direction !== "recvonly" &&
        audioTransceiver.direction !== "inactive"
      ) {
        audioTransceiver.direction = "recvonly"
      }
      return
    }

    peer.addTransceiver("audio", { direction: "recvonly" })
  }, [])

  const ensurePeer = useCallback(
    (remotePlayerId: string) => {
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId || remotePlayerId === selfPlayerId) {
        return null
      }

      const existingPeer = peersRef.current.get(remotePlayerId)
      if (existingPeer) return existingPeer

      const peer = new RTCPeerConnection(voicePeerConfig)
      void syncLocalAudioToPeer(peer)

      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        emitSignal(remotePlayerId, {
          type: "ice-candidate",
          candidate: event.candidate.toJSON(),
        })
      }

      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track])
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
    [closePeer, emitSignal, syncLocalAudioToPeer],
  )

  const flushPendingIceCandidates = useCallback(
    async (remotePlayerId: string, peer: RTCPeerConnection) => {
      const pendingCandidates = pendingIceCandidatesRef.current.get(remotePlayerId)
      if (!pendingCandidates?.length || !peer.remoteDescription) return

      pendingIceCandidatesRef.current.delete(remotePlayerId)
      for (const candidate of pendingCandidates) {
        await peer.addIceCandidate(candidate)
      }
    },
    [],
  )

  const createOffer = useCallback(
    async (remotePlayerId: string) => {
      if (negotiatingPeersRef.current.has(remotePlayerId)) return
      const peer = ensurePeer(remotePlayerId)
      if (!peer || peer.signalingState !== "stable") return

      negotiatingPeersRef.current.add(remotePlayerId)
      try {
        await syncLocalAudioToPeer(peer)
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        if (!peer.localDescription?.sdp) return
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
    [emitSignal, ensurePeer, syncLocalAudioToPeer],
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

  const syncAllPeers = useCallback(async () => {
    const tasks: Promise<void>[] = []
    for (const peer of peersRef.current.values()) {
      tasks.push(syncLocalAudioToPeer(peer))
    }
    await Promise.all(tasks)
  }, [syncLocalAudioToPeer])

  const negotiateWithOfferablePeers = useCallback(() => {
    const selfPlayerId = selfPlayerIdRef.current
    if (!selfPlayerId || !enabledRef.current) return

    for (const player of playersRef.current) {
      if (player.id === selfPlayerId) continue
      if (!voiceStatesRef.current[player.id]?.enabled) continue
      ensurePeer(player.id)
      if (shouldCreateOffer(player.id)) void createOffer(player.id)
    }
  }, [createOffer, ensurePeer, shouldCreateOffer])

  const publishLocalVoiceState = useCallback(
    (state: VoicePeerState) => {
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId) return
      setVoiceStateForPlayer(selfPlayerId, state)
      emitVoiceState(state)
    },
    [emitVoiceState, setVoiceStateForPlayer],
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
    socketRef.current?.emit("voice:requestStates")
    connectToEnabledPeers()
  }, [connectToEnabledPeers, publishLocalVoiceState])

  const setLocalMuted = useCallback(
    async (nextMuted: boolean) => {
      const selfPlayerId = selfPlayerIdRef.current
      if (!selfPlayerId || !enabledRef.current || !localStreamRef.current) return

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
      await syncAllPeers()
      negotiateWithOfferablePeers()
    },
    [negotiateWithOfferablePeers, publishLocalVoiceState, syncAllPeers],
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
    [emitVoiceState, setVoiceStateForPlayer, stopSpeakingMeter],
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
      socketRef.current?.emit("voice:requestStates")
      startSpeakingMeter(stream)
      await syncAllPeers()
      connectToEnabledPeers()
      negotiateWithOfferablePeers()
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
    negotiateWithOfferablePeers,
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
        switch (event.signal.type) {
          case "offer": {
            await peer.setRemoteDescription({
              type: "offer",
              sdp: event.signal.sdp,
            })
            await syncLocalAudioToPeer(peer)
            await flushPendingIceCandidates(event.fromPlayerId, peer)
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
              await flushPendingIceCandidates(event.fromPlayerId, peer)
            }
            break
          case "ice-candidate":
            if (event.signal.candidate) {
              const candidate = event.signal.candidate as RTCIceCandidateInit
              if (peer.remoteDescription) {
                await peer.addIceCandidate(candidate)
              } else {
                const pendingCandidates =
                  pendingIceCandidatesRef.current.get(event.fromPlayerId) ?? []
                pendingCandidates.push(candidate)
                pendingIceCandidatesRef.current.set(
                  event.fromPlayerId,
                  pendingCandidates,
                )
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
      syncLocalAudioToPeer,
    ],
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
        ensurePeer(event.playerId)
        if (shouldCreateOffer(event.playerId)) void createOffer(event.playerId)
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
    shouldCreateOffer,
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
    ],
  )
}
