import { randomUUID } from "node:crypto"

import {
  MUSIC_HISTORY_LIMIT,
  MUSIC_LIKED_SONG_LIMIT,
  MUSIC_QUEUE_LIMIT,
  type CommandResult,
  type MusicHistoryEntry,
  type MusicLiker,
  type MusicTrack,
  type QueuedTrack,
  type RoomMusicSnapshot,
} from "@workspace/game"

type Requester = { id: string; name: string }

type RoomMusicState = {
  nowPlaying: QueuedTrack | null
  /** Epoch ms at which position 0 of `nowPlaying` played (while playing). */
  startedAtMs: number
  /** Frozen position while paused. */
  pausedAtSec: number | null
  queue: QueuedTrack[]
  history: MusicHistoryEntry[]
  likes: Map<string, MusicLiker[]>
  endTimer: ReturnType<typeof setTimeout> | null
  version: number
}

type RoomMusicOptions = {
  now?: () => number
  searchAvailable?: () => boolean
  /** Called whenever a room's music state changes on its own (track ended). */
  onStateChanged?: (code: string) => void
}

/** Extra time past a track's length before the server advances on its own. */
const END_GRACE_MS = 2_500
/** Unknown-length tracks may be ended by a client after this long. */
const MIN_REPORTED_PLAY_SEC = 10

/** Where a new song lands: after the queue, at its front, or playing now. */
export type EnqueueMode = "end" | "next" | "now"

export type EnqueueOutcome = {
  entry: QueuedTrack
  /** "playing" when it started right away, otherwise its 1-based queue spot. */
  placement: "playing" | number
}

/**
 * Authoritative per-room music state. The server owns the clock: clients get
 * `positionSec` + `serverNow` and seek their own players to match, so every
 * listener hears the same part of the same song.
 */
export class RoomMusic {
  private readonly rooms = new Map<string, RoomMusicState>()
  private readonly now: () => number
  private readonly searchAvailable: () => boolean
  private readonly onStateChanged?: (code: string) => void

  constructor(options: RoomMusicOptions = {}) {
    this.now = options.now ?? Date.now
    this.searchAvailable = options.searchAvailable ?? (() => false)
    this.onStateChanged = options.onStateChanged
  }

  snapshot(code: string): RoomMusicSnapshot {
    const state = this.rooms.get(code)
    const serverNow = this.now()
    if (!state) {
      return {
        status: "idle",
        nowPlaying: null,
        positionSec: 0,
        serverNow,
        queue: [],
        history: [],
        likes: {},
        searchAvailable: this.searchAvailable(),
        version: 0,
      }
    }
    return {
      status: !state.nowPlaying
        ? "idle"
        : state.pausedAtSec === null
          ? "playing"
          : "paused",
      nowPlaying: state.nowPlaying ? { ...state.nowPlaying } : null,
      positionSec: this.positionSec(state),
      serverNow,
      queue: state.queue.map((entry) => ({ ...entry })),
      history: state.history.map((entry) => ({ ...entry })),
      likes: Object.fromEntries(
        Array.from(state.likes, ([id, likers]) => [
          id,
          likers.map((liker) => ({ ...liker })),
        ])
      ),
      searchAvailable: this.searchAvailable(),
      version: state.version,
    }
  }

  nowPlaying(code: string): QueuedTrack | null {
    return this.rooms.get(code)?.nowPlaying ?? null
  }

  queue(code: string): QueuedTrack[] {
    return [...(this.rooms.get(code)?.queue ?? [])]
  }

  isPaused(code: string): boolean {
    const state = this.rooms.get(code)
    return Boolean(state?.nowPlaying && state.pausedAtSec !== null)
  }

  enqueue(
    code: string,
    track: MusicTrack,
    requester: Requester,
    mode: EnqueueMode = "end"
  ): CommandResult<EnqueueOutcome> {
    const state = this.ensure(code)
    if (
      mode !== "now" &&
      state.nowPlaying &&
      state.queue.length >= MUSIC_QUEUE_LIMIT
    ) {
      return fail(
        "music-queue-full",
        `The queue is full (${MUSIC_QUEUE_LIMIT} songs). Skip or remove some first.`
      )
    }
    const entry: QueuedTrack = {
      ...track,
      queueId: randomUUID(),
      requestedByPlayerId: requester.id,
      requestedByName: requester.name,
      requestedAt: new Date(this.now()).toISOString(),
    }
    // "now" replaces whatever is playing; the queue behind it is untouched.
    if (!state.nowPlaying || mode === "now") {
      this.start(code, state, entry)
      return ok({ entry, placement: "playing" })
    }
    if (mode === "next") state.queue.unshift(entry)
    else state.queue.push(entry)
    state.version++
    return ok({
      entry,
      placement: mode === "next" ? 1 : state.queue.length,
    })
  }

  pause(code: string): CommandResult<null> {
    const state = this.rooms.get(code)
    if (!state?.nowPlaying) return fail("music-idle", "Nothing is playing.")
    if (state.pausedAtSec !== null) return ok(null)
    state.pausedAtSec = this.positionSec(state)
    this.clearEndTimer(state)
    state.version++
    return ok(null)
  }

  resume(code: string): CommandResult<null> {
    const state = this.rooms.get(code)
    if (!state?.nowPlaying) return fail("music-idle", "Nothing is playing.")
    if (state.pausedAtSec === null) return ok(null)
    state.startedAtMs = this.now() - state.pausedAtSec * 1_000
    state.pausedAtSec = null
    this.scheduleEnd(code, state)
    state.version++
    return ok(null)
  }

  /** Jumps the current song to `positionSec`, playing or paused. */
  seek(code: string, positionSec: number): CommandResult<null> {
    const state = this.rooms.get(code)
    const current = state?.nowPlaying
    if (!state || !current) return fail("music-idle", "Nothing is playing.")
    if (current.durationSec === null) {
      return fail("music-not-seekable", "Live streams can't be scrubbed.")
    }
    if (!Number.isFinite(positionSec)) {
      return fail("music-invalid", "Pick a point in the song.")
    }
    // Stop just short of the end so a seek never counts as finishing it.
    const target = Math.min(
      Math.max(0, positionSec),
      Math.max(0, current.durationSec - 1)
    )
    if (state.pausedAtSec !== null) {
      state.pausedAtSec = target
    } else {
      state.startedAtMs = this.now() - target * 1_000
      this.scheduleEnd(code, state)
    }
    state.version++
    return ok(null)
  }

  /** Skips the current song; returns the song that was skipped. */
  skip(code: string): CommandResult<QueuedTrack> {
    const state = this.rooms.get(code)
    const current = state?.nowPlaying
    if (!state || !current) return fail("music-idle", "Nothing is playing.")
    this.advance(code, state)
    return ok(current)
  }

  /** Stops playback and clears the queue. History remains. */
  stop(code: string): CommandResult<null> {
    const state = this.rooms.get(code)
    if (!state?.nowPlaying && !state?.queue.length) {
      return fail("music-idle", "Nothing is playing.")
    }
    this.clearEndTimer(state)
    state.nowPlaying = null
    state.pausedAtSec = null
    state.queue = []
    state.version++
    return ok(null)
  }

  clearQueue(code: string): number {
    const state = this.rooms.get(code)
    if (!state) return 0
    const removed = state.queue.length
    state.queue = []
    if (removed) state.version++
    return removed
  }

  remove(code: string, queueId: string): CommandResult<QueuedTrack> {
    const state = this.rooms.get(code)
    const index = state?.queue.findIndex((entry) => entry.queueId === queueId)
    if (!state || index === undefined || index < 0) {
      return fail("music-not-queued", "That song is no longer in the queue.")
    }
    const [removed] = state.queue.splice(index, 1)
    state.version++
    return ok(removed as QueuedTrack)
  }

  /**
   * A client's player finished the current song. Accepted only once the
   * server clock agrees the song is (nearly) over, so one listener cannot
   * cut a song short for everyone. Returns true when playback advanced.
   */
  reportEnded(code: string, queueId: string): boolean {
    const state = this.rooms.get(code)
    if (!state?.nowPlaying || state.nowPlaying.queueId !== queueId) return false
    if (state.pausedAtSec !== null) return false
    const position = this.positionSec(state)
    const duration = state.nowPlaying.durationSec
    const minimum =
      duration === null ? MIN_REPORTED_PLAY_SEC : Math.max(0, duration - 5)
    if (position < minimum) return false
    this.advance(code, state)
    return true
  }

  /** A client cannot play the current song. Skip it and say which. */
  reportUnplayable(code: string, queueId: string): QueuedTrack | null {
    const state = this.rooms.get(code)
    const current = state?.nowPlaying
    if (!state || !current || current.queueId !== queueId) return null
    this.advance(code, state)
    return current
  }

  /** Records whether a player likes a song. Idempotent in both directions. */
  setLike(
    code: string,
    videoId: string,
    player: Requester,
    liked: boolean
  ): boolean {
    const state = this.ensure(code)
    const likers = state.likes.get(videoId) ?? []
    const has = likers.some((liker) => liker.playerId === player.id)
    if (has === liked) return false
    if (liked) {
      // Re-insert so recently liked songs are the last to be forgotten.
      state.likes.delete(videoId)
      state.likes.set(videoId, [
        ...likers,
        { playerId: player.id, name: player.name },
      ])
      while (state.likes.size > MUSIC_LIKED_SONG_LIMIT) {
        const oldest = state.likes.keys().next().value
        if (oldest === undefined) break
        state.likes.delete(oldest)
      }
    } else {
      const remaining = likers.filter((liker) => liker.playerId !== player.id)
      if (remaining.length) state.likes.set(videoId, remaining)
      else state.likes.delete(videoId)
    }
    state.version++
    return true
  }

  clearRoom(code: string) {
    const state = this.rooms.get(code)
    if (state) this.clearEndTimer(state)
    this.rooms.delete(code)
  }

  private ensure(code: string): RoomMusicState {
    let state = this.rooms.get(code)
    if (!state) {
      state = {
        nowPlaying: null,
        startedAtMs: 0,
        pausedAtSec: null,
        queue: [],
        history: [],
        likes: new Map(),
        endTimer: null,
        version: 0,
      }
      this.rooms.set(code, state)
    }
    return state
  }

  private start(code: string, state: RoomMusicState, entry: QueuedTrack) {
    this.clearEndTimer(state)
    state.nowPlaying = entry
    state.startedAtMs = this.now()
    state.pausedAtSec = null
    const {
      queueId: _q,
      requestedByPlayerId: _p,
      requestedAt: _a,
      ...track
    } = entry
    state.history = [
      {
        ...track,
        playedAt: new Date(this.now()).toISOString(),
        requestedByName: entry.requestedByName,
      },
      ...state.history.filter((played) => played.id !== entry.id),
    ].slice(0, MUSIC_HISTORY_LIMIT)
    this.scheduleEnd(code, state)
    state.version++
  }

  private advance(code: string, state: RoomMusicState) {
    const next = state.queue.shift()
    if (next) {
      this.start(code, state, next)
      return
    }
    this.clearEndTimer(state)
    state.nowPlaying = null
    state.pausedAtSec = null
    state.version++
  }

  private scheduleEnd(code: string, state: RoomMusicState) {
    this.clearEndTimer(state)
    const duration = state.nowPlaying?.durationSec
    if (!state.nowPlaying || duration === null || duration === undefined) return
    const queueId = state.nowPlaying.queueId
    const remainingMs = Math.max(
      0,
      duration * 1_000 - this.positionSec(state) * 1_000
    )
    state.endTimer = setTimeout(() => {
      state.endTimer = null
      if (state.nowPlaying?.queueId !== queueId) return
      this.advance(code, state)
      this.onStateChanged?.(code)
    }, remainingMs + END_GRACE_MS)
    state.endTimer.unref?.()
  }

  private clearEndTimer(state: RoomMusicState) {
    if (state.endTimer) clearTimeout(state.endTimer)
    state.endTimer = null
  }

  private positionSec(state: RoomMusicState): number {
    if (!state.nowPlaying) return 0
    if (state.pausedAtSec !== null) return state.pausedAtSec
    const elapsed = Math.max(0, (this.now() - state.startedAtMs) / 1_000)
    const duration = state.nowPlaying.durationSec
    return duration === null ? elapsed : Math.min(elapsed, duration)
  }
}

function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data }
}

function fail<T>(code: string, message: string): CommandResult<T> {
  return { ok: false, error: { code, message } }
}
