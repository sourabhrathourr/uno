/** The chat identity of the room's music bot. Players summon it with `@DJ`. */
export const DJ_BOT_ID = "bot:dj"
export const DJ_BOT_NAME = "DJ"

export const MUSIC_QUEUE_LIMIT = 50
export const MUSIC_HISTORY_LIMIT = 100
/** Songs per room whose likes are remembered; the oldest drop off. */
export const MUSIC_LIKED_SONG_LIMIT = 300

/** A YouTube video the room can play. `id` is the YouTube video ID. */
export type MusicTrack = {
  id: string
  title: string
  artist: string
  /** Length in whole seconds, or null when YouTube did not report it. */
  durationSec: number | null
  thumbnailUrl: string
}

export type QueuedTrack = MusicTrack & {
  /** Unique per queue entry, so the same song can be queued twice. */
  queueId: string
  requestedByPlayerId: string
  requestedByName: string
  requestedAt: string
}

export type MusicHistoryEntry = MusicTrack & {
  playedAt: string
  requestedByName: string
}

export type MusicPlaybackStatus = "idle" | "playing" | "paused"

export type RoomMusicSnapshot = {
  status: MusicPlaybackStatus
  nowPlaying: QueuedTrack | null
  /** Playback position in seconds at `serverNow`. */
  positionSec: number
  /** Server clock (epoch ms) when this snapshot was taken, for drift sync. */
  serverNow: number
  queue: QueuedTrack[]
  /** Most recent first. */
  history: MusicHistoryEntry[]
  /** Who in this room liked each song, keyed by video ID, oldest first. */
  likes: Record<string, MusicLiker[]>
  /** False when the server has no YouTube API key and cannot search by name. */
  searchAvailable: boolean
  version: number
}

export type MusicSearchResponse = {
  results: MusicTrack[]
}

export type MusicEnqueueInput = {
  videoId: string
  /** Insert at the front of the queue instead of the back. */
  playNext?: boolean
  /** Replace the current song and start this one right away. */
  playNow?: boolean
}

export type MusicControlAction = "pause" | "resume" | "skip" | "stop"

export type MusicControlInput = { action: MusicControlAction }
export type MusicRemoveInput = { queueId: string }
export type MusicSeekInput = { positionSec: number }
export type MusicTrackReportInput = { queueId: string }
export type MusicLiker = { playerId: string; name: string }
export type MusicLikeInput = { videoId: string; liked: boolean }

export function isYouTubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(value)
}

/**
 * Pulls a YouTube video ID out of a pasted link (watch, youtu.be, shorts,
 * embed, music.youtube.com) or a bare ID. Returns null for anything else.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim()
  if (isYouTubeVideoId(value)) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m)\./, "").toLowerCase()
  let candidate: string | null = null
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v")
    else {
      const match = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(url.pathname)
      candidate = match?.[1] ?? null
    }
  }
  return candidate && isYouTubeVideoId(candidate) ? candidate : null
}

export function formatTrackDuration(totalSec: number | null): string {
  if (totalSec === null || !Number.isFinite(totalSec) || totalSec < 0)
    return "--:--"
  const whole = Math.floor(totalSec)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = String(whole % 60).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`
}
