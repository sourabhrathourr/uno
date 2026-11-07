import { sanitizeWorldAvatarState, sanitizeWorldTempo } from "@workspace/game"
import type { Socket } from "socket.io"
import type {
  ClientToServerEvents,
  InterServerEvents,
  MusicTrack,
  ServerToClientEvents,
  SocketData,
  WorldTempo,
} from "@workspace/game"

type LoungeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

/** Avatars move at most this often per socket; extra updates are dropped. */
const MOVE_MIN_INTERVAL_MS = 45
const LOOKUP_CACHE_MS = 7 * 24 * 60 * 60 * 1_000
const LOOKUP_CACHE_LIMIT = 3_000
const LOOKUP_TIMEOUT_MS = 3_500
const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * Finds a song's tempo from its title. YouTube doesn't publish BPM, and the
 * song's audio never reaches us (it plays in each listener's YouTube embed),
 * so we ask Deezer's public catalogue, which lists BPM for most released
 * tracks. Its search is unavailable in some regions; then this returns null
 * and the lounge guesses from the title until someone taps the beat in.
 */
export class TempoLookup {
  private readonly fetcher: Fetcher
  private readonly now: () => number
  private readonly maxLookupsPerDay: number
  private lookupTimes: number[] = []
  private readonly cache = new Map<
    string,
    { expiresAt: number; bpm: number | null }
  >()
  private readonly inFlight = new Map<string, Promise<number | null>>()

  constructor(
    options: {
      fetcher?: Fetcher
      now?: () => number
      maxLookupsPerDay?: number
    } = {}
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.maxLookupsPerDay = options.maxLookupsPerDay ?? 2_000
  }

  async bpmFor(track: Pick<MusicTrack, "id" | "title" | "artist">) {
    const cached = this.cache.get(track.id)
    if (cached && cached.expiresAt > this.now()) return cached.bpm
    const pending = this.inFlight.get(track.id)
    if (pending) return pending

    const request = this.lookup(track)
      .catch(() => null)
      .then((bpm) => {
        this.inFlight.delete(track.id)
        this.remember(track.id, bpm)
        return bpm
      })
    this.inFlight.set(track.id, request)
    return request
  }

  private async lookup(track: Pick<MusicTrack, "title" | "artist">) {
    const { title, artist } = cleanSongTitle(track.title, track.artist)
    if (!title) return null
    if (!this.spendBudget()) return null

    const query = artist ? `${artist} ${title}` : title
    const search = await this.getJson(
      `https://api.deezer.com/search/track?limit=5&q=${encodeURIComponent(query)}`
    )
    const candidates = Array.isArray(search?.data) ? search.data : []
    const match = candidates.find((candidate: unknown) =>
      isSameSong(candidate, title, artist)
    ) as { id?: unknown } | undefined
    if (typeof match?.id !== "number") return null

    const details = await this.getJson(`https://api.deezer.com/track/${match.id}`)
    const bpm = typeof details?.bpm === "number" ? details.bpm : 0
    return bpm >= 50 && bpm <= 220 ? Math.round(bpm * 100) / 100 : null
  }

  private async getJson(url: string): Promise<Record<string, any> | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
    try {
      const response = await this.fetcher(url, { signal: controller.signal })
      if (!response.ok) return null
      return (await response.json()) as Record<string, any>
    } finally {
      clearTimeout(timer)
    }
  }

  private spendBudget() {
    const since = this.now() - DAY_MS
    this.lookupTimes = this.lookupTimes.filter((time) => time > since)
    if (this.lookupTimes.length >= this.maxLookupsPerDay) return false
    this.lookupTimes.push(this.now())
    return true
  }

  private remember(videoId: string, bpm: number | null) {
    if (this.cache.size >= LOOKUP_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(videoId, { expiresAt: this.now() + LOOKUP_CACHE_MS, bpm })
  }
}

/**
 * Strips YouTube decoration so a title matches a catalogue entry:
 * "Artist - Song (Official Video) [4K]" by "ArtistVEVO" -> Song / Artist.
 */
export function cleanSongTitle(rawTitle: string, rawArtist: string) {
  let title = rawTitle
    .replace(/\[[^\]]*\]/g, " ")
    .replace(
      /\((?:[^)]*\b(?:official|video|audio|lyrics?|lyric|visuali[sz]er|hd|4k|remaster(?:ed)?|live|mv|music video)\b[^)]*)\)/gi,
      " "
    )
    .replace(/\b(?:ft|feat|featuring)\.?\s.*$/i, " ")
    .replace(/\|.*$/, " ")
  let artist = rawArtist
    .replace(/\s*-\s*topic$/i, "")
    .replace(/vevo$/i, "")
    .replace(/\bofficial\b/gi, "")
    .trim()

  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash) {
    artist = dash[1]!.trim()
    title = dash[2]!
  }
  title = title
    .replace(/\((?:[^)]*\b(?:official|video|audio|lyrics?)\b[^)]*)\)/gi, " ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return { title, artist: artist.replace(/\s+/g, " ").trim() }
}

function isSameSong(candidate: unknown, title: string, artist: string) {
  if (!candidate || typeof candidate !== "object") return false
  const value = candidate as {
    title?: unknown
    title_short?: unknown
    artist?: { name?: unknown }
  }
  const candidateTitle = String(value.title_short ?? value.title ?? "")
  const candidateArtist = String(value.artist?.name ?? "")
  const titleMatches = overlap(words(title), words(candidateTitle)) >= 0.6
  const artistMatches =
    !artist || overlap(words(candidateArtist), words(artist)) >= 0.5
  return titleMatches && artistMatches
}

function words(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
}

/** Share of `expected` words that appear in `actual`. */
function overlap(expected: string[], actual: string[]) {
  if (expected.length === 0) return 0
  const pool = new Set(actual)
  return expected.filter((word) => pool.has(word)).length / expected.length
}

/**
 * Relays lounge avatars between the players of a room and keeps one tapped
 * tempo per room, so everyone's lights follow the same beat grid.
 */
export class Lounge {
  private readonly tempos = new Map<string, WorldTempo>()

  constructor(
    private readonly deps: {
      tempoLookup: TempoLookup
      nowPlaying: (roomCode: string) => MusicTrack | null
      playerName: (roomCode: string, playerId: string) => string | null
    }
  ) {}

  attach(socket: LoungeSocket) {
    let lastMoveAt = 0

    socket.on("world:move", (input) => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId) return
      const now = Date.now()
      if (now - lastMoveAt < MOVE_MIN_INTERVAL_MS) return
      const state = sanitizeWorldAvatarState(input)
      if (!state) return
      lastMoveAt = now
      socket.to(roomCode).volatile.emit("world:moved", { ...state, playerId })
    })

    socket.on("world:leave", () => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId) return
      socket.to(roomCode).emit("world:left", { playerId })
    })

    socket.on("world:tapTempo", (input) => {
      const { roomCode, playerId } = socket.data
      if (!roomCode || !playerId) return
      const tempo = sanitizeWorldTempo(input)
      if (!tempo) return
      const next: WorldTempo = {
        ...tempo,
        source: "tap",
        setByName: this.deps.playerName(roomCode, playerId) ?? undefined,
      }
      this.tempos.set(roomCode, next)
      socket.nsp.to(roomCode).emit("world:tempo", next)
    })

    socket.on("world:getTempo", (input, ack) => {
      if (typeof ack !== "function") return
      const { roomCode } = socket.data
      const videoId = typeof input?.videoId === "string" ? input.videoId : ""
      if (!roomCode) {
        ack({
          ok: false,
          error: { code: "not-joined", message: "Join a room first." },
        })
        return
      }
      void this.tempoFor(roomCode, videoId).then((tempo) =>
        ack({ ok: true, data: tempo })
      )
    })

    socket.on("disconnect", () => {
      const { roomCode, playerId } = socket.data
      if (roomCode && playerId)
        socket.to(roomCode).emit("world:left", { playerId })
    })
  }

  async tempoFor(roomCode: string, videoId: string): Promise<WorldTempo | null> {
    const tapped = this.tempos.get(roomCode)
    if (tapped?.videoId === videoId) return tapped
    const track = this.deps.nowPlaying(roomCode)
    if (!track || track.id !== videoId) return null
    const bpm = await this.deps.tempoLookup.bpmFor(track)
    return bpm ? { videoId, bpm, offsetSec: 0, source: "lookup" } : null
  }

  clearRoom(roomCode: string) {
    this.tempos.delete(roomCode)
  }
}
