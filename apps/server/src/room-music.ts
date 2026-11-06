import { randomUUID } from "node:crypto"

import {
  MUSIC_HISTORY_LIMIT,
  MUSIC_LIKED_SONG_LIMIT,
  MUSIC_PLAYLIST_LIMIT,
  MUSIC_PLAYLIST_NAME_MAX_LENGTH,
  MUSIC_PLAYLIST_TRACK_LIMIT,
  MUSIC_QUEUE_LIMIT,
  type CommandResult,
  type MusicHistoryEntry,
  type MusicLiker,
  type MusicTrack,
  type QueuedTrack,
  type RoomMusicSnapshot,
  type RoomPlaylist,
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
  playlists: RoomPlaylist[]
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
        playlists: [],
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
      playlists: state.playlists.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((track) => ({ ...track })),
      })),
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
    options: { playNext?: boolean } = {}
  ): CommandResult<EnqueueOutcome> {
    const state = this.ensure(code)
    if (state.nowPlaying && state.queue.length >= MUSIC_QUEUE_LIMIT) {
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
    if (!state.nowPlaying) {
      this.start(code, state, entry)
      return ok({ entry, placement: "playing" })
    }
    if (options.playNext) state.queue.unshift(entry)
    else state.queue.push(entry)
    state.version++
    return ok({
      entry,
      placement: options.playNext ? 1 : state.queue.length,
    })
  }

  /** Queues as many tracks as fit; returns how many were added. */
  enqueueMany(code: string, tracks: MusicTrack[], requester: Requester) {
    let added = 0
    for (const track of tracks) {
      if (!this.enqueue(code, track, requester).ok) break
      added++
    }
    return added
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

  /** Skips the current song; returns the song that was skipped. */
  skip(code: string): CommandResult<QueuedTrack> {
    const state = this.rooms.get(code)
    const current = state?.nowPlaying
    if (!state || !current) return fail("music-idle", "Nothing is playing.")
    this.advance(code, state)
    return ok(current)
  }

  /** Stops playback and clears the queue. History and playlists remain. */
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

  createPlaylist(
    code: string,
    name: string,
    creator: Requester
  ): CommandResult<RoomPlaylist> {
    const state = this.ensure(code)
    const cleaned = cleanPlaylistName(name)
    if (!cleaned) return fail("playlist-name", "Give the playlist a name.")
    if (state.playlists.length >= MUSIC_PLAYLIST_LIMIT) {
      return fail(
        "playlist-limit",
        `This room already has ${MUSIC_PLAYLIST_LIMIT} playlists.`
      )
    }
    if (this.findPlaylistByName(code, cleaned)) {
      return fail("playlist-exists", `“${cleaned}” already exists.`)
    }
    const playlist: RoomPlaylist = {
      id: randomUUID(),
      name: cleaned,
      createdByPlayerId: creator.id,
      createdByName: creator.name,
      tracks: [],
      updatedAt: new Date(this.now()).toISOString(),
    }
    state.playlists.push(playlist)
    state.version++
    return ok(playlist)
  }

  deletePlaylist(code: string, playlistId: string): CommandResult<null> {
    const state = this.rooms.get(code)
    const index = state?.playlists.findIndex((p) => p.id === playlistId) ?? -1
    if (!state || index < 0)
      return fail("playlist-missing", "No such playlist.")
    state.playlists.splice(index, 1)
    state.version++
    return ok(null)
  }

  addToPlaylist(
    code: string,
    playlistId: string,
    track: MusicTrack
  ): CommandResult<RoomPlaylist> {
    const state = this.rooms.get(code)
    const playlist = state?.playlists.find((p) => p.id === playlistId)
    if (!state || !playlist)
      return fail("playlist-missing", "No such playlist.")
    if (playlist.tracks.some((existing) => existing.id === track.id)) {
      return ok(playlist)
    }
    if (playlist.tracks.length >= MUSIC_PLAYLIST_TRACK_LIMIT) {
      return fail(
        "playlist-full",
        `A playlist holds up to ${MUSIC_PLAYLIST_TRACK_LIMIT} songs.`
      )
    }
    playlist.tracks.push({ ...track })
    playlist.updatedAt = new Date(this.now()).toISOString()
    state.version++
    return ok(playlist)
  }

  removeFromPlaylist(
    code: string,
    playlistId: string,
    videoId: string
  ): CommandResult<RoomPlaylist> {
    const state = this.rooms.get(code)
    const playlist = state?.playlists.find((p) => p.id === playlistId)
    if (!state || !playlist)
      return fail("playlist-missing", "No such playlist.")
    const before = playlist.tracks.length
    playlist.tracks = playlist.tracks.filter((track) => track.id !== videoId)
    if (playlist.tracks.length !== before) {
      playlist.updatedAt = new Date(this.now()).toISOString()
      state.version++
    }
    return ok(playlist)
  }

  findPlaylist(code: string, playlistId: string): RoomPlaylist | null {
    return (
      this.rooms.get(code)?.playlists.find((p) => p.id === playlistId) ?? null
    )
  }

  /** Exact name match first, then the first playlist whose name starts with it. */
  findPlaylistByName(code: string, name: string): RoomPlaylist | null {
    const needle = cleanPlaylistName(name).toLocaleLowerCase()
    if (!needle) return null
    const playlists = this.rooms.get(code)?.playlists ?? []
    return (
      playlists.find((p) => p.name.toLocaleLowerCase() === needle) ??
      playlists.find((p) => p.name.toLocaleLowerCase().startsWith(needle)) ??
      null
    )
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
        playlists: [],
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

export function cleanPlaylistName(value: string): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, MUSIC_PLAYLIST_NAME_MAX_LENGTH)
    : ""
}

function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data }
}

function fail<T>(code: string, message: string): CommandResult<T> {
  return { ok: false, error: { code, message } }
}
