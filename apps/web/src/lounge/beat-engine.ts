import { useCallback, useEffect, useRef, useState } from "react"
import { Color } from "three"
import {
  gridFromTempo,
  guessGrid,
  hashString,
  sampleBeat,
  tempoFromTaps,
} from "./beat"
import type { RoomMusicSnapshot, WorldTempo } from "@workspace/game"

import type { BeatGrid, Mood } from "./beat"
import type { GameSocket } from "@/lib/realtime"
import type { RoomMusicController } from "@/lib/room-music"
import { estimatePositionSec } from "@/lib/room-music"

/** Colour sets per mood; the lights step through them bar by bar. */
const PALETTES: Record<Mood, Array<Array<string>>> = {
  idle: [["#6b3cff", "#ff8a3d", "#2a1a5e"]],
  chill: [
    ["#7b4dff", "#2ec5ff", "#ff9a5c"],
    ["#b04dff", "#ff6fa8", "#4d7bff"],
    ["#3dd6c6", "#7b4dff", "#ffb35c"],
  ],
  groove: [
    ["#ff3d9a", "#2ee6ff", "#ffb02e"],
    ["#8c3dff", "#ff5c3d", "#3dff9e"],
    ["#ff2e6e", "#4d6bff", "#ffe14d"],
    ["#2effc8", "#ff3df2", "#ff8a2e"],
  ],
  hype: [
    ["#ff1f3d", "#1f6bff", "#ffffff"],
    ["#00ff9c", "#ff00d4", "#fff200"],
    ["#ff6a00", "#00d4ff", "#ff0055"],
    ["#a400ff", "#00ff3c", "#ffffff"],
    ["#ff0040", "#ffe600", "#00b3ff"],
  ],
}

/**
 * Everything the lights read each frame. Mutated in place by `update`, so
 * scene components can read it inside useFrame without re-rendering.
 */
export class BeatState {
  playing = false
  positionSec = 0
  grid: BeatGrid = { bpm: 100, offsetSec: 0, mood: "idle", source: "none" }
  beat = 0
  phase = 0
  kick = 0
  bar = 0
  phrase = 0
  /** 0..1, eases toward the mood's level; 0 when nothing plays. */
  energy = 0
  /** Smoothly follows `kick` for things that shouldn't flicker. */
  pulse = 0
  /** 0..1 while a strobe burst is on (hype phrase ends only). */
  strobe = 0
  time = 0
  readonly colors = [new Color(), new Color(), new Color()]
  private readonly targets = [new Color(), new Color(), new Color()]
  reducedMotion = false

  update(
    now: number,
    dt: number,
    snapshot: RoomMusicSnapshot | null,
    receivedAt: number,
    grid: BeatGrid
  ) {
    this.time += dt
    this.playing =
      snapshot?.status === "playing" && Boolean(snapshot.nowPlaying)
    this.grid = this.playing ? grid : { ...grid, mood: "idle" }
    const mood = this.grid.mood

    if (this.playing && snapshot) {
      this.positionSec = estimatePositionSec(snapshot, receivedAt, now)
      const sample = sampleBeat(this.positionSec, this.grid)
      this.beat = sample.beat
      this.phase = sample.phase
      this.kick = sample.kick
      this.bar = sample.bar
      this.phrase = sample.phrase
    } else {
      // A slow idle breath so the room never looks frozen.
      this.beat = this.time * 0.5
      this.phase = this.beat % 1
      this.kick = 0
      this.bar = Math.floor(this.beat / 4)
      this.phrase = 0
    }

    const targetEnergy =
      mood === "hype"
        ? 1
        : mood === "groove"
          ? 0.7
          : mood === "chill"
            ? 0.4
            : 0.12
    this.energy += (targetEnergy - this.energy) * Math.min(1, dt * 0.8)
    this.pulse += (this.kick - this.pulse) * Math.min(1, dt * 18)

    // A strobe bar flashes once per beat on the last bar of every 8-bar
    // phrase, hype songs only, and never with reduced motion. It stays a
    // small fixture so the whole screen never flashes.
    const barInPhrase = ((this.bar % 8) + 8) % 8
    this.strobe =
      mood === "hype" &&
      !this.reducedMotion &&
      barInPhrase === 7 &&
      this.phase < 0.18
        ? 1
        : 0

    const sets = PALETTES[mood]
    const step =
      mood === "chill" ? 8 : mood === "groove" ? 4 : mood === "hype" ? 2 : 1
    const seed = hashString(snapshot?.nowPlaying?.id ?? "idle")
    const index = (Math.floor(this.bar / step) + seed) % sets.length
    const set = sets[Math.abs(index)]
    for (let i = 0; i < 3; i++) this.targets[i].set(set[i])
    const blend = Math.min(
      1,
      dt * (mood === "hype" ? 10 : mood === "groove" ? 4 : 1.2)
    )
    for (let i = 0; i < 3; i++) this.colors[i].lerp(this.targets[i], blend)
  }
}

/**
 * Keeps the room's beat grid for the current song: asks the server (which
 * knows tapped or catalogue tempos), listens for taps from others, and lets
 * this player tap the beat in.
 */
export function useBeatGrid(
  socket: GameSocket | null,
  music: RoomMusicController | null
) {
  const track = music?.snapshot?.nowPlaying ?? null
  const videoId = track?.id ?? null
  const [tempo, setTempo] = useState<WorldTempo | null>(null)
  const taps = useRef<{
    videoId: string | null
    at: Array<number>
    last: number
  }>({
    videoId: null,
    at: [],
    last: 0,
  })
  const [tapCount, setTapCount] = useState(0)

  useEffect(() => {
    setTempo(null)
    if (!socket || !videoId) return
    let cancelled = false
    socket.emit("world:getTempo", { videoId }, (result) => {
      if (cancelled || !result.ok || !result.data) return
      setTempo((current) =>
        current?.source === "tap" && current.videoId === videoId
          ? current
          : result.data
      )
    })
    const onTempo = (next: WorldTempo) => {
      if (next.videoId === videoId) setTempo(next)
    }
    socket.on("world:tempo", onTempo)
    return () => {
      cancelled = true
      socket.off("world:tempo", onTempo)
    }
  }, [socket, videoId])

  const grid: BeatGrid = !track
    ? { bpm: 100, offsetSec: 0, mood: "idle", source: "none" }
    : tempo && tempo.videoId === track.id
      ? gridFromTempo(tempo, track.title, track.artist)
      : guessGrid(track.title, track.artist)

  const tap = useCallback(() => {
    const snapshot = music?.snapshot
    if (
      !socket ||
      !music ||
      !snapshot?.nowPlaying ||
      snapshot.status !== "playing"
    )
      return
    const position = estimatePositionSec(snapshot, music.receivedAt)
    const state = taps.current
    if (state.videoId !== snapshot.nowPlaying.id || position - state.last > 2) {
      state.videoId = snapshot.nowPlaying.id
      state.at = []
    }
    state.last = position
    state.at = [...state.at, position].slice(-12)
    setTapCount(state.at.length)
    const result = tempoFromTaps(state.at)
    if (result && state.at.length >= 6) {
      socket.emit("world:tapTempo", {
        videoId: snapshot.nowPlaying.id,
        ...result,
      })
    }
  }, [socket, music])

  // Tap streaks end after a pause; reset the counter shown in the HUD.
  useEffect(() => {
    if (tapCount === 0) return
    const timer = window.setTimeout(() => setTapCount(0), 2_000)
    return () => window.clearTimeout(timer)
  }, [tapCount])

  return { grid, tap, tapCount }
}
