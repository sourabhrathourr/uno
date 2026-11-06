import { isYouTubeVideoId, type MusicTrack } from "@workspace/game"

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

type YouTubeServiceOptions = {
  apiKey?: string
  fetcher?: Fetcher
  now?: () => number
  regionCode?: string
  /**
   * Uncached searches allowed per rolling 24 hours. A search costs 101 quota
   * units (search.list + videos.list) against YouTube's default 10,000/day.
   */
  maxSearchesPerDay?: number
  maxSearchesPerRequesterPerHour?: number
}

const SEARCH_RESULT_LIMIT = 12
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1_000
const TRACK_CACHE_MS = 7 * 24 * 60 * 60 * 1_000
const TRACK_CACHE_LIMIT = 5_000
const SEARCH_CACHE_LIMIT = 1_000
const DAY_MS = 24 * 60 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000

export class MusicSearchError extends Error {
  constructor(
    readonly code:
      | "search-unconfigured"
      | "search-budget"
      | "search-player-budget"
      | "search-failed",
    message: string
  ) {
    super(message)
  }
}

export class YouTubeService {
  private readonly apiKey: string
  private readonly fetcher: Fetcher
  private readonly now: () => number
  private readonly regionCode: string
  private readonly maxSearchesPerDay: number
  private readonly maxSearchesPerRequesterPerHour: number
  private searchTimes: number[] = []
  private readonly searchTimesByRequester = new Map<string, number[]>()
  private readonly searchCache = new Map<
    string,
    { expiresAt: number; results: MusicTrack[] }
  >()
  private readonly trackCache = new Map<
    string,
    { expiresAt: number; track: MusicTrack | null }
  >()

  constructor(options: YouTubeServiceOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? ""
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.regionCode = cleanRegionCode(options.regionCode)
    this.maxSearchesPerDay = positiveInteger(options.maxSearchesPerDay) ?? 95
    this.maxSearchesPerRequesterPerHour =
      positiveInteger(options.maxSearchesPerRequesterPerHour) ?? 20
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  async search(query: string, requesterId?: string): Promise<MusicTrack[]> {
    const cleaned = cleanQuery(query)
    if (!cleaned) return []
    if (!this.configured) {
      throw new MusicSearchError(
        "search-unconfigured",
        "Song search needs YOUTUBE_API_KEY on the server. Paste a YouTube link instead."
      )
    }

    const cacheKey = cleaned.toLocaleLowerCase()
    const cached = this.searchCache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return cached.results

    this.consumeSearchBudget(requesterId)

    const url = new URL("https://www.googleapis.com/youtube/v3/search")
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("part", "snippet")
    url.searchParams.set("type", "video")
    url.searchParams.set("maxResults", String(SEARCH_RESULT_LIMIT))
    url.searchParams.set("q", cleaned)
    // Only videos other sites may embed, so every listener can play them.
    url.searchParams.set("videoEmbeddable", "true")
    url.searchParams.set("videoSyndicated", "true")
    url.searchParams.set("safeSearch", "none")
    if (this.regionCode) url.searchParams.set("regionCode", this.regionCode)

    const payload = await this.getJson<YouTubeSearchPayload>(url)
    const ids = (payload.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => Boolean(id && isYouTubeVideoId(id)))

    const tracks = await this.fetchTracks(ids)
    const results = ids
      .map((id) => tracks.get(id))
      .filter((track): track is MusicTrack => Boolean(track))

    this.prune(this.searchCache, SEARCH_CACHE_LIMIT)
    this.searchCache.set(cacheKey, {
      expiresAt: this.now() + SEARCH_CACHE_MS,
      results,
    })
    return results
  }

  /**
   * Looks up one video by ID. Uses the Data API when configured (which also
   * gives duration and embeddability) and falls back to keyless oEmbed.
   * Returns null for videos that do not exist or cannot be embedded.
   */
  async resolveTrack(videoId: string): Promise<MusicTrack | null> {
    if (!isYouTubeVideoId(videoId)) return null
    const cached = this.trackCache.get(videoId)
    if (cached && cached.expiresAt > this.now()) return cached.track

    if (this.configured) {
      const tracks = await this.fetchTracks([videoId])
      return tracks.get(videoId) ?? null
    }

    const track = await this.fetchOEmbed(videoId)
    this.cacheTrack(videoId, track)
    return track
  }

  private async fetchTracks(ids: string[]): Promise<Map<string, MusicTrack>> {
    const found = new Map<string, MusicTrack>()
    const missing: string[] = []
    for (const id of ids) {
      const cached = this.trackCache.get(id)
      if (cached && cached.expiresAt > this.now()) {
        if (cached.track) found.set(id, cached.track)
      } else missing.push(id)
    }
    if (missing.length === 0) return found

    const url = new URL("https://www.googleapis.com/youtube/v3/videos")
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("part", "snippet,contentDetails,status")
    url.searchParams.set("id", missing.join(","))
    url.searchParams.set("maxResults", String(missing.length))
    const payload = await this.getJson<YouTubeVideosPayload>(url)

    const returned = new Set<string>()
    for (const item of payload.items ?? []) {
      const track = normalizeVideo(item)
      if (!item.id) continue
      returned.add(item.id)
      this.cacheTrack(item.id, track)
      if (track) found.set(item.id, track)
    }
    for (const id of missing) {
      if (!returned.has(id)) this.cacheTrack(id, null)
    }
    return found
  }

  private async fetchOEmbed(videoId: string): Promise<MusicTrack | null> {
    const url = new URL("https://www.youtube.com/oembed")
    url.searchParams.set(
      "url",
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    )
    url.searchParams.set("format", "json")
    let response: Response
    try {
      response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      })
    } catch (cause) {
      throw new MusicSearchError(
        "search-failed",
        `YouTube lookup failed: ${String(cause)}`
      )
    }
    // 401/403 = embedding disabled, 404 = removed or private.
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    )
      return null
    if (!response.ok) {
      throw new MusicSearchError(
        "search-failed",
        `YouTube lookup failed with ${response.status}.`
      )
    }
    const payload = (await response.json()) as {
      title?: string
      author_name?: string
    }
    return {
      id: videoId,
      title: cleanText(payload.title, 120) || "Untitled",
      artist: cleanArtist(payload.author_name),
      durationSec: null,
      thumbnailUrl: thumbnailFor(videoId),
    }
  }

  private async getJson<T>(url: URL): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      })
    } catch (cause) {
      throw new MusicSearchError(
        "search-failed",
        `YouTube request failed: ${String(cause)}`
      )
    }
    if (!response.ok) {
      // 403 here is almost always the daily quota running out.
      throw new MusicSearchError(
        response.status === 403 ? "search-budget" : "search-failed",
        response.status === 403
          ? "YouTube search is out of quota for today."
          : `YouTube request failed with ${response.status}.`
      )
    }
    return (await response.json()) as T
  }

  private cacheTrack(id: string, track: MusicTrack | null) {
    this.prune(this.trackCache, TRACK_CACHE_LIMIT)
    this.trackCache.set(id, { expiresAt: this.now() + TRACK_CACHE_MS, track })
  }

  private prune<V extends { expiresAt: number }>(
    cache: Map<string, V>,
    limit: number
  ) {
    const now = this.now()
    for (const [key, value] of cache) {
      if (value.expiresAt <= now) cache.delete(key)
    }
    // Maps iterate in insertion order, so the oldest entries go first.
    while (cache.size >= limit) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  private consumeSearchBudget(requesterId: string | undefined) {
    const now = this.now()
    this.searchTimes = this.searchTimes.filter((at) => at > now - DAY_MS)
    for (const [id, times] of this.searchTimesByRequester) {
      const recent = times.filter((at) => at > now - HOUR_MS)
      if (recent.length > 0) this.searchTimesByRequester.set(id, recent)
      else this.searchTimesByRequester.delete(id)
    }

    const requester = requesterId?.trim().slice(0, 128) || "anonymous"
    const requesterTimes = this.searchTimesByRequester.get(requester) ?? []
    if (requesterTimes.length >= this.maxSearchesPerRequesterPerHour) {
      throw new MusicSearchError(
        "search-player-budget",
        "You have searched a lot this hour. Try a song from the history or a playlist."
      )
    }
    if (this.searchTimes.length >= this.maxSearchesPerDay) {
      throw new MusicSearchError(
        "search-budget",
        "Song search is out of quota for today. Paste a YouTube link instead."
      )
    }
    requesterTimes.push(now)
    this.searchTimesByRequester.set(requester, requesterTimes)
    this.searchTimes.push(now)
  }
}

type YouTubeSearchPayload = {
  items?: Array<{ id?: { videoId?: string } }>
}

type YouTubeVideosPayload = {
  items?: Array<{
    id?: string
    snippet?: {
      title?: string
      channelTitle?: string
      liveBroadcastContent?: string
    }
    contentDetails?: { duration?: string }
    status?: { embeddable?: boolean; privacyStatus?: string }
  }>
}

function normalizeVideo(
  item: NonNullable<YouTubeVideosPayload["items"]>[number]
): MusicTrack | null {
  const id = item.id
  if (!id || !isYouTubeVideoId(id)) return null
  if (item.status?.embeddable === false) return null
  if (item.status?.privacyStatus === "private") return null
  const live = item.snippet?.liveBroadcastContent
  const durationSec =
    live === "live" || live === "upcoming"
      ? null
      : parseIsoDuration(item.contentDetails?.duration)
  return {
    id,
    title: cleanText(item.snippet?.title, 120) || "Untitled",
    artist: cleanArtist(item.snippet?.channelTitle),
    durationSec,
    thumbnailUrl: thumbnailFor(id),
  }
}

/** Parses YouTube's ISO 8601 durations such as `PT4M13S` or `P1DT2H`. */
export function parseIsoDuration(value: string | undefined): number | null {
  if (!value) return null
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value
    )
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Math.floor(Number(seconds ?? 0))
  return total > 0 ? total : null
}

function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

function cleanArtist(value: string | undefined): string {
  // Auto-generated music channels are named "Artist - Topic".
  return cleanText(value, 80).replace(/ - Topic$/, "") || "YouTube"
}

function cleanText(value: string | undefined, max: number): string {
  return decodeEntities(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max)
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function cleanQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 100)
}

function cleanRegionCode(value: string | undefined): string {
  const code = value?.trim().toUpperCase() ?? ""
  return /^[A-Z]{2}$/.test(code) ? code : ""
}

function positiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null
}
