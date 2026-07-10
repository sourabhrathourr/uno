import { LoaderCircle, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { searchGifs } from "../lib/realtime"
import type {
  GifSearchResponse,
  GifSearchResult,
  SendChatMessageInput,
} from "@workspace/game"

type SearchGifs = (input: {
  query: string
  offset: number
  signal?: AbortSignal
}) => Promise<GifSearchResponse>

const GIPHY_ATTRIBUTION_URL =
  "https://developers.giphy.com/branch/master/static/attribution@2x-d66dd0ec49c03f6ba401354859bfca13.png"

export function GifPicker({
  comfortable = false,
  onSelect,
  search = searchGifs,
}: {
  comfortable?: boolean
  onSelect: (input: SendChatMessageInput) => void
  search?: SearchGifs
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Array<GifSearchResult>>([])
  const [source, setSource] = useState<GifSearchResponse["source"] | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const delay = query.trim() ? 300 : 0
    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void search({ query, offset: 0, signal: controller.signal })
        .then((response) => {
          if (requestIdRef.current !== requestId) return
          setResults(response.results)
          setSource(response.source)
          setNextOffset(response.nextOffset)
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || requestIdRef.current !== requestId)
            return
          setError(
            cause instanceof Error
              ? cause.message
              : "GIF search is temporarily unavailable."
          )
          setResults([])
          setNextOffset(null)
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false)
        })
    }, delay)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [query, search])

  async function loadMore() {
    if (nextOffset === null || loadingMore) return
    const requestId = requestIdRef.current
    setLoadingMore(true)
    setError(null)
    try {
      const response = await search({ query, offset: nextOffset })
      if (requestIdRef.current !== requestId) return
      setResults((current) => [...current, ...response.results])
      setSource(response.source)
      setNextOffset(response.nextOffset)
    } catch (cause) {
      if (requestIdRef.current !== requestId) return
      setError(
        cause instanceof Error ? cause.message : "Could not load more GIFs."
      )
    } finally {
      setLoadingMore(false)
    }
  }

  function selectGif(gif: GifSearchResult) {
    onSelect(gifChatInput(gif))
  }

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/36"
          strokeWidth={2}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={50}
          placeholder="Search GIFs"
          aria-label="Search GIFs"
          className="h-9 w-full rounded-lg border border-white/10 bg-neutral-950/76 pr-3 pl-8 text-sm text-white/84 outline-none placeholder:text-white/32 focus:border-white/24"
        />
      </label>

      <div
        className={
          "uno-scrollbar grid grid-cols-2 gap-2 overflow-y-auto pr-1 " +
          (comfortable ? "max-h-[30dvh]" : "max-h-40")
        }
        aria-busy={loading}
      >
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <span
                key={index}
                className="h-20 animate-pulse rounded-xl border border-white/8 bg-white/[0.055]"
              />
            ))
          : results.map((gif) => (
              <button
                key={`${gif.provider}:${gif.id}`}
                type="button"
                onClick={() => selectGif(gif)}
                aria-label={`Send ${gif.title}`}
                className="group min-h-20 overflow-hidden rounded-xl bg-black/36 text-left shadow-[0_10px_24px_rgba(0,0,0,0.22),inset_0_0_0_1px_rgba(255,255,255,0.075)] transition-[scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:brightness-110 active:scale-[0.96]"
              >
                <img
                  src={gif.previewUrl}
                  alt=""
                  className="h-16 w-full object-cover outline outline-1 outline-white/10"
                  loading="lazy"
                />
                <span className="block truncate px-2 py-1.5 text-[11px] font-medium text-white/64 group-hover:text-white/84">
                  {gif.title}
                </span>
              </button>
            ))}
      </div>

      {!loading && results.length === 0 && !error && (
        <p className="rounded-lg border border-white/8 bg-black/24 px-3 py-4 text-center text-xs text-white/48">
          No GIFs found. Try another search.
        </p>
      )}
      {error && <p className="text-xs text-red-200/80">{error}</p>}

      <div className="flex min-h-7 items-center justify-between gap-2">
        {source === "giphy" ? (
          <img
            src={GIPHY_ATTRIBUTION_URL}
            alt="Powered by GIPHY"
            className="h-4 w-auto opacity-70"
          />
        ) : (
          <span className="text-[10px] text-white/36">Featured GIFs</span>
        )}
        {nextOffset !== null && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-[10px] font-medium text-white/62 hover:bg-white/[0.09] disabled:opacity-50"
          >
            {loadingMore && (
              <LoaderCircle
                className="size-3 animate-spin"
                aria-hidden="true"
              />
            )}
            Load more
          </button>
        )}
      </div>
    </div>
  )
}

export function gifChatInput(gif: GifSearchResult): SendChatMessageInput {
  return {
    kind: "gif",
    body: gif.id,
    gifProvider: gif.provider,
  }
}
