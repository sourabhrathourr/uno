import {
  CHAT_GIFS,
  type GifSearchResponse,
  type GifSearchResult,
} from "@workspace/game"

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

type ApprovedGif = {
  body: string
  label: string
}

type GiphyServiceOptions = {
  apiKey?: string
  fetcher?: Fetcher
  now?: () => number
  countryCode?: string
  maxRequestsPerHour?: number
  maxRequestsPerRequesterPerHour?: number
}

type SearchInput = {
  query: string
  offset: number
  requesterId?: string
}

const SEARCH_LIMIT = 20
const MAX_SEARCH_OFFSET = 4_999
const SEARCH_CACHE_MS = 5 * 60 * 1_000
const APPROVED_GIF_MS = 60 * 60 * 1_000

export class GiphyService {
  private readonly apiKey: string
  private readonly fetcher: Fetcher
  private readonly now: () => number
  private readonly countryCode: string
  private readonly maxRequestsPerHour: number
  private readonly maxRequestsPerRequesterPerHour: number
  private upstreamRequestTimes: number[] = []
  private readonly requestTimesByRequester = new Map<string, number[]>()
  private readonly searchCache = new Map<
    string,
    { expiresAt: number; response: GifSearchResponse }
  >()
  private readonly approvedGifs = new Map<
    string,
    { expiresAt: number; gif: ApprovedGif }
  >()

  constructor(options: GiphyServiceOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? ""
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
    this.countryCode = cleanCountryCode(options.countryCode)
    this.maxRequestsPerHour = positiveInteger(options.maxRequestsPerHour) ?? 90
    this.maxRequestsPerRequesterPerHour =
      positiveInteger(options.maxRequestsPerRequesterPerHour) ?? 30
  }

  get configured(): boolean {
    return Boolean(this.apiKey)
  }

  async search(input: SearchInput): Promise<GifSearchResponse> {
    const query = cleanQuery(input.query)
    const offset = clampOffset(input.offset)
    if (!this.configured) return curatedSearch(query)

    this.pruneExpiredEntries()

    const cacheKey = `${query.toLocaleLowerCase()}:${offset}`
    const cached = this.searchCache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return cached.response

    const searchQuery = query || "reaction"
    const url = new URL("https://api.giphy.com/v1/gifs/search")
    url.searchParams.set("api_key", this.apiKey)
    url.searchParams.set("limit", String(SEARCH_LIMIT))
    url.searchParams.set("offset", String(offset))
    url.searchParams.set("rating", "pg")
    url.searchParams.set("bundle", "messaging_non_clips")
    url.searchParams.set("q", searchQuery)
    url.searchParams.set("lang", "en")
    if (this.countryCode) url.searchParams.set("country_code", this.countryCode)

    this.consumeRequestBudget(input.requesterId)
    const apiResponse = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    })
    if (!apiResponse.ok) {
      throw new Error(`GIPHY search failed with ${apiResponse.status}.`)
    }

    const payload = (await apiResponse.json()) as GiphyPayload
    if (payload.meta?.status !== 200 || !Array.isArray(payload.data)) {
      throw new Error("GIPHY returned an invalid search response.")
    }

    const results = payload.data
      .map(normalizeGif)
      .filter((gif): gif is GifSearchResult => Boolean(gif))
    const count = payload.pagination?.count ?? results.length
    const total = payload.pagination?.total_count ?? offset + count
    const candidateOffset = offset + count
    const nextOffset =
      candidateOffset > offset &&
      candidateOffset < total &&
      candidateOffset <= MAX_SEARCH_OFFSET
        ? candidateOffset
        : null
    const response: GifSearchResponse = {
      results,
      nextOffset,
      source: "giphy",
    }

    for (const gif of results) {
      this.approvedGifs.set(gif.id, {
        expiresAt: this.now() + APPROVED_GIF_MS,
        gif: { body: gif.mediaUrl, label: gif.title },
      })
    }
    this.searchCache.set(cacheKey, {
      expiresAt: this.now() + SEARCH_CACHE_MS,
      response,
    })
    return response
  }

  resolveApprovedGif(id: string): ApprovedGif | null {
    const approved = this.approvedGifs.get(id)
    if (!approved) return null
    if (approved.expiresAt <= this.now()) {
      this.approvedGifs.delete(id)
      return null
    }
    return { ...approved.gif }
  }

  private consumeRequestBudget(requesterId: string | undefined) {
    const now = this.now()
    const cutoff = now - 60 * 60 * 1_000
    this.upstreamRequestTimes = this.upstreamRequestTimes.filter(
      (requestedAt) => requestedAt > cutoff
    )
    for (const [id, requestTimes] of this.requestTimesByRequester) {
      const recentTimes = requestTimes.filter(
        (requestedAt) => requestedAt > cutoff
      )
      if (recentTimes.length > 0)
        this.requestTimesByRequester.set(id, recentTimes)
      else this.requestTimesByRequester.delete(id)
    }

    const normalizedRequesterId = cleanRequesterId(requesterId)
    const requesterTimes =
      this.requestTimesByRequester.get(normalizedRequesterId) ?? []
    if (requesterTimes.length >= this.maxRequestsPerRequesterPerHour) {
      throw new Error("GIPHY player request budget exhausted.")
    }
    if (this.upstreamRequestTimes.length >= this.maxRequestsPerHour) {
      throw new Error("GIPHY request budget exhausted.")
    }
    requesterTimes.push(now)
    this.requestTimesByRequester.set(normalizedRequesterId, requesterTimes)
    this.upstreamRequestTimes.push(now)
  }

  private pruneExpiredEntries() {
    const now = this.now()
    for (const [key, cached] of this.searchCache) {
      if (cached.expiresAt <= now) this.searchCache.delete(key)
    }
    for (const [id, approved] of this.approvedGifs) {
      if (approved.expiresAt <= now) this.approvedGifs.delete(id)
    }
  }
}

type GiphyRendition = {
  url?: string
  webp?: string
  width?: string
  height?: string
}

type GiphyPayload = {
  data?: Array<{
    id?: string
    title?: string
    images?: {
      fixed_width_small?: GiphyRendition
      fixed_width?: GiphyRendition
      original?: GiphyRendition
    }
  }>
  pagination?: {
    count?: number
    total_count?: number
  }
  meta?: { status?: number }
}

function normalizeGif(
  input: NonNullable<GiphyPayload["data"]>[number]
): GifSearchResult | null {
  const id = input.id?.trim()
  const preview = input.images?.fixed_width_small ?? input.images?.fixed_width
  const original = input.images?.original
  const previewUrl = trustedGiphyUrl(preview?.webp ?? preview?.url)
  const mediaUrl = trustedGiphyUrl(original?.webp ?? original?.url)
  if (!id || !previewUrl || !mediaUrl) return null

  return {
    provider: "giphy" as const,
    id,
    title: cleanTitle(input.title),
    previewUrl,
    mediaUrl,
    width:
      positiveInteger(original?.width) ?? positiveInteger(preview?.width) ?? 1,
    height:
      positiveInteger(original?.height) ??
      positiveInteger(preview?.height) ??
      1,
  }
}

function curatedSearch(query: string): GifSearchResponse {
  const normalizedQuery = query.toLocaleLowerCase()
  return {
    results: CHAT_GIFS.filter(
      (gif) =>
        !normalizedQuery ||
        gif.label.toLocaleLowerCase().includes(normalizedQuery)
    ).map((gif) => ({
      provider: "curated" as const,
      id: gif.url,
      title: gif.label,
      previewUrl: gif.url,
      mediaUrl: gif.url,
      width: 1,
      height: 1,
    })),
    nextOffset: null,
    source: "curated",
  }
}

function trustedGiphyUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const trustedHost =
      url.hostname === "i.giphy.com" ||
      /^media\d*\.giphy\.com$/i.test(url.hostname)
    return url.protocol === "https:" && trustedHost ? url.toString() : null
  } catch {
    return null
  }
}

function cleanQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 50)
}

function cleanTitle(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 80) || "GIF"
}

function cleanCountryCode(value: string | undefined): string {
  const countryCode = value?.trim().toUpperCase() ?? ""
  return /^[A-Z]{2}$/.test(countryCode) ? countryCode : ""
}

function cleanRequesterId(value: string | undefined): string {
  return value?.trim().slice(0, 128) || "anonymous"
}

function clampOffset(value: number): number {
  if (!Number.isInteger(value)) return 0
  return Math.min(MAX_SEARCH_OFFSET, Math.max(0, value))
}

function positiveInteger(value: string | number | undefined): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
