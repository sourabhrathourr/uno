/**
 * The lounge: an optional 3D room where players walk around as avatars, sit
 * at the game table and dance by the DJ booth. The game itself is untouched;
 * the lounge only shares where everyone is standing and what they're doing.
 * The server relays these updates and keeps nothing but the room's tempo.
 */

export type WorldAnimation = "idle" | "walk" | "run" | "jump" | "dance" | "sit"

export const WORLD_ANIMATIONS: ReadonlyArray<WorldAnimation> = [
  "idle",
  "walk",
  "run",
  "jump",
  "dance",
  "sit",
]

/** Dance moves an avatar can do; the number keys pick one. */
export const WORLD_DANCE_COUNT = 4

/** Half the floor's width and depth in metres; positions are clamped to it. */
export const WORLD_HALF_EXTENT = 14

export type WorldAvatarState = {
  x: number
  y: number
  z: number
  /** Facing, radians around the vertical axis. */
  heading: number
  animation: WorldAnimation
  /** Which dance, when `animation` is "dance". */
  dance: number
}

export type WorldMoveInput = WorldAvatarState

export type WorldMovedEvent = WorldAvatarState & {
  playerId: string
}

export type WorldLeftEvent = {
  playerId: string
}

/**
 * The beat grid the lights follow for one song. `offsetSec` is the song
 * position of a downbeat, so beat n lands at `offsetSec + n * 60 / bpm`.
 */
export type WorldTempo = {
  videoId: string
  bpm: number
  offsetSec: number
  /** "tap": someone tapped it in. "lookup": a music database knew it. */
  source: "tap" | "lookup"
  setByName?: string
}

export type WorldTempoTapInput = {
  videoId: string
  bpm: number
  offsetSec: number
}

export type WorldTempoGetInput = {
  videoId: string
}

export const WORLD_MIN_BPM = 50
export const WORLD_MAX_BPM = 220

/**
 * Checks and clamps an avatar update from a client. Returns null for anything
 * that isn't a usable position, so a bad client can't push NaN into others.
 */
export function sanitizeWorldAvatarState(
  input: unknown
): WorldAvatarState | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  const x = finite(value.x)
  const y = finite(value.y)
  const z = finite(value.z)
  const heading = finite(value.heading)
  if (x === null || y === null || z === null || heading === null) return null
  const animation = WORLD_ANIMATIONS.includes(value.animation as WorldAnimation)
    ? (value.animation as WorldAnimation)
    : "idle"
  const dance = finite(value.dance) ?? 0
  const limit = WORLD_HALF_EXTENT + 1
  return {
    x: round(clamp(x, -limit, limit)),
    y: round(clamp(y, -1, 8)),
    z: round(clamp(z, -limit, limit)),
    heading: round(wrapAngle(heading)),
    animation,
    dance: clamp(Math.round(dance), 0, WORLD_DANCE_COUNT - 1),
  }
}

export function sanitizeWorldTempo(input: unknown): WorldTempoTapInput | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  const videoId = typeof value.videoId === "string" ? value.videoId : ""
  const bpm = finite(value.bpm)
  const offsetSec = finite(value.offsetSec)
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  if (bpm === null || offsetSec === null) return null
  if (bpm < WORLD_MIN_BPM || bpm > WORLD_MAX_BPM) return null
  if (offsetSec < 0 || offsetSec > 6 * 60 * 60) return null
  return { videoId, bpm: Math.round(bpm * 100) / 100, offsetSec: round(offsetSec) }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}

function wrapAngle(value: number) {
  const turn = Math.PI * 2
  return ((((value + Math.PI) % turn) + turn) % turn) - Math.PI
}
