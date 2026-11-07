import type { WorldTempo } from "@workspace/game"

/**
 * The lounge lights can't hear the music: each player's song plays inside a
 * YouTube embed whose audio the page can't read. Instead the lights follow a
 * beat grid laid over the room's shared playback clock. The grid's tempo
 * comes from a music catalogue (server lookup), from someone tapping along
 * (shared with the room), or, failing both, a guess from the song title.
 */

export type Mood = "idle" | "chill" | "groove" | "hype"

export type BeatGrid = {
  bpm: number
  offsetSec: number
  mood: Mood
  source: "tap" | "lookup" | "guess" | "none"
  setByName?: string
}

export type BeatSample = {
  /** Beats since the grid's downbeat, fractional. */
  beat: number
  /** 0..1 position within the current beat. */
  phase: number
  /** 1 on the beat, decaying toward 0 before the next one. */
  kick: number
  /** Whole bars (4 beats) since the downbeat. */
  bar: number
  /** Whole 8-bar phrases since the downbeat. */
  phrase: number
  /** Beats per second the lights pulse at (half-time for fast songs). */
  pulseBpm: number
}

const CHILL_WORDS = [
  "lofi",
  "lo-fi",
  "lo fi",
  "chill",
  "slowed",
  "reverb",
  "acoustic",
  "piano",
  "ambient",
  "sleep",
  "study",
  "relax",
  "ballad",
  "unplugged",
  "jazz",
  "sad",
  "calm",
  "rain",
  "soft",
  "lullaby",
  "instrumental",
  "unwind",
  "ghazal",
  "sufi",
]

const HYPE_WORDS = [
  "remix",
  "edm",
  "techno",
  "house",
  "trance",
  "dubstep",
  "drum and bass",
  "dnb",
  "phonk",
  "hardstyle",
  "bass",
  "rave",
  "party",
  "club",
  "festival",
  "drop",
  "hype",
  "workout",
  "gym",
  "trap",
  "mashup",
  "dance",
  "bhangra",
  "dj ",
  "sped up",
  "nightcore",
  "metal",
  "punk",
]

/** A tempo and mood from the song's title alone. Same answer for everyone. */
export function guessGrid(title: string, artist = ""): BeatGrid {
  const text = ` ${title} ${artist} `.toLowerCase()
  const chill = CHILL_WORDS.filter((word) => text.includes(word)).length
  const hype = HYPE_WORDS.filter((word) => text.includes(word)).length
  // Spread guesses a little per song so two songs don't feel identical.
  const jitter = (hashString(title) % 9) - 4
  if (chill > hype)
    return { bpm: 80 + jitter, offsetSec: 0, mood: "chill", source: "guess" }
  if (hype > chill)
    return { bpm: 126 + jitter, offsetSec: 0, mood: "hype", source: "guess" }
  return { bpm: 110 + jitter, offsetSec: 0, mood: "groove", source: "guess" }
}

/**
 * Mood for a known tempo. Title words still win for the obvious cases: a
 * slowed+reverb edit is chill whatever its BPM says.
 */
export function moodForTempo(bpm: number, title: string, artist = ""): Mood {
  const guessed = guessGrid(title, artist).mood
  if (guessed === "chill") return "chill"
  if (guessed === "hype" && bpm >= 95) return "hype"
  // Very fast tempos are usually felt in half time (trap, DnB, synthpop).
  const felt = bpm > 150 ? bpm / 2 : bpm
  if (felt < 92) return bpm > 150 ? "groove" : "chill"
  if (felt < 118) return bpm > 150 ? "hype" : "groove"
  return "hype"
}

export function gridFromTempo(
  tempo: WorldTempo,
  title: string,
  artist = ""
): BeatGrid {
  return {
    bpm: tempo.bpm,
    offsetSec: tempo.offsetSec,
    mood: moodForTempo(tempo.bpm, title, artist),
    source: tempo.source,
    setByName: tempo.setByName,
  }
}

export function sampleBeat(positionSec: number, grid: BeatGrid): BeatSample {
  const pulseBpm = grid.bpm > 150 ? grid.bpm / 2 : grid.bpm
  const beat = ((positionSec - grid.offsetSec) * pulseBpm) / 60
  const whole = Math.floor(beat)
  const phase = beat - whole
  const decay = grid.mood === "chill" ? 3 : grid.mood === "hype" ? 7 : 5
  return {
    beat,
    phase,
    kick: Math.exp(-phase * decay),
    bar: Math.floor(whole / 4),
    phrase: Math.floor(whole / 32),
    pulseBpm,
  }
}

/**
 * Tempo and downbeat from taps, each the song position (seconds) the tap
 * landed on. Needs at least 4 taps within the last few seconds; uses the
 * median interval so one sloppy tap doesn't skew it.
 */
export function tempoFromTaps(
  taps: Array<number>
): { bpm: number; offsetSec: number } | null {
  if (taps.length < 4) return null
  const intervals: Array<number> = []
  for (let index = 1; index < taps.length; index++) {
    const gap = taps[index] - taps[index - 1]
    if (gap > 0.25 && gap < 1.5) intervals.push(gap)
  }
  if (intervals.length < 3) return null
  const sorted = [...intervals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const steady = intervals.filter(
    (gap) => Math.abs(gap - median) < median * 0.2
  )
  if (steady.length < 3) return null
  const interval = steady.reduce((sum, gap) => sum + gap, 0) / steady.length
  const bpm = Math.round((60 / interval) * 10) / 10
  if (bpm < 50 || bpm > 220) return null

  // Average where the taps fall on the grid, so the downbeat sits on them.
  let sin = 0
  let cos = 0
  for (const tap of taps) {
    const angle = ((tap % interval) / interval) * Math.PI * 2
    sin += Math.sin(angle)
    cos += Math.cos(angle)
  }
  const angle = Math.atan2(sin, cos)
  const offsetSec =
    ((((angle / (Math.PI * 2)) * interval) % interval) + interval) % interval
  return { bpm, offsetSec: Math.round(offsetSec * 1000) / 1000 }
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
