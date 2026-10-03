import { useCallback, useEffect, useRef, useState } from "react"
import { logRoomVoiceDebug } from "@/lib/use-room-voice"

export function VoiceAudioOutputs({
  streamsByPlayerId,
  connectionIssues,
  playerNames,
}: {
  streamsByPlayerId: Partial<Record<string, MediaStream>>
  connectionIssues: Record<string, string>
  playerNames: Record<string, string>
}) {
  const [blocked, setBlocked] = useState<Record<string, boolean>>({})
  const audioElements = useRef(new Set<HTMLAudioElement>())
  const updateBlocked = useCallback((playerId: string, value: boolean) => {
    setBlocked((current) => {
      if (Boolean(current[playerId]) === value) return current
      const next = { ...current }
      if (value) next[playerId] = true
      else delete next[playerId]
      return next
    })
  }, [])
  const blockedPlayers = Object.keys(blocked).filter(
    (id) => streamsByPlayerId[id]
  )
  return (
    <>
      {Object.entries(streamsByPlayerId).map(
        ([playerId, stream]) =>
          stream && (
            <RemoteVoiceAudio
              key={playerId}
              playerId={playerId}
              stream={stream}
              audioElements={audioElements.current}
              onBlocked={updateBlocked}
            />
          )
      )}
      {(blockedPlayers.length > 0 ||
        Object.keys(connectionIssues).length > 0) && (
        <div className="fixed top-16 right-3 z-[80] max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-neutral-950/95 px-3 py-2 text-sm text-white shadow-lg">
          {Object.entries(connectionIssues).map(([playerId, message]) => (
            <p key={playerId} role="status">
              {message}
            </p>
          ))}
          {blockedPlayers.length > 0 && (
            <button
              type="button"
              className="min-h-10 rounded-lg px-2 underline underline-offset-4"
              onClick={() => {
                // Keep play() inside the user gesture, including on Safari.
                for (const audio of audioElements.current)
                  audio.dispatchEvent(new Event("voice-retry"))
              }}
            >
              Tap to hear{" "}
              {blockedPlayers
                .map((id) => playerNames[id] ?? "a player")
                .join(", ")}
            </button>
          )}
        </div>
      )}
    </>
  )
}

function RemoteVoiceAudio({
  playerId,
  stream,
  audioElements,
  onBlocked,
}: {
  playerId: string
  stream: MediaStream
  audioElements: Set<HTMLAudioElement>
  onBlocked: (playerId: string, blocked: boolean) => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let active = true
    let attempt = 0
    audio.srcObject = stream
    audio.muted = false
    audio.volume = 1
    audioElements.add(audio)
    const play = () => {
      if (!active) return
      const currentAttempt = ++attempt
      void audio
        .play()
        .then(() => {
          if (active && currentAttempt === attempt) onBlocked(playerId, false)
        })
        .catch((cause) => {
          if (!active || currentAttempt !== attempt) return
          onBlocked(playerId, true)
          logRoomVoiceDebug("remote playback blocked", { playerId, cause })
        })
    }
    const paused = () => {
      if (active && audio.readyState >= 2) onBlocked(playerId, true)
    }
    const failed = () => {
      if (active) onBlocked(playerId, true)
    }
    const playing = () => onBlocked(playerId, false)
    const visible = () => {
      if (document.visibilityState === "visible") play()
    }
    const tracks = stream.getAudioTracks()
    audio.addEventListener("voice-retry", play)
    audio.addEventListener("loadedmetadata", play)
    audio.addEventListener("canplay", play)
    audio.addEventListener("pause", paused)
    audio.addEventListener("error", failed)
    audio.addEventListener("stalled", failed)
    audio.addEventListener("playing", playing)
    for (const event of ["pointerdown", "touchend", "keydown"] as const)
      window.addEventListener(event, play, { capture: true })
    document.addEventListener("visibilitychange", visible)
    for (const track of tracks) track.addEventListener("unmute", play)
    play()
    return () => {
      active = false
      audioElements.delete(audio)
      onBlocked(playerId, false)
      audio.removeEventListener("voice-retry", play)
      audio.removeEventListener("loadedmetadata", play)
      audio.removeEventListener("canplay", play)
      audio.removeEventListener("pause", paused)
      audio.removeEventListener("error", failed)
      audio.removeEventListener("stalled", failed)
      audio.removeEventListener("playing", playing)
      for (const event of ["pointerdown", "touchend", "keydown"] as const)
        window.removeEventListener(event, play, { capture: true })
      document.removeEventListener("visibilitychange", visible)
      for (const track of tracks) track.removeEventListener("unmute", play)
      audio.srcObject = null
    }
  }, [audioElements, onBlocked, playerId, stream])
  return (
    <audio
      ref={audioRef}
      data-player-id={playerId}
      autoPlay
      playsInline
      className="pointer-events-none absolute size-px opacity-0"
    />
  )
}
