import {
  Check,
  Heart,
  ListMusic,
  ListPlus,
  ListStart,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { formatTrackDuration } from "@workspace/game"
import type {
  MusicTrack,
  QueuedTrack,
  RoomMusicSnapshot,
  RoomPlaylist,
} from "@workspace/game"
import type { ReactNode } from "react"

import type { RoomMusicController } from "@/lib/room-music"
import type { YouTubePlayer } from "@/lib/youtube-player"
import {
  estimatePositionSec,
  searchMusic,
  useLikedSongs,
  useMusicController,
  useMusicPanel,
  useMusicVolume,
} from "@/lib/room-music"
import { YT_STATE, loadYouTubeApi } from "@/lib/youtube-player"

const EASE_OUT = "ease-[cubic-bezier(0.23,1,0.32,1)]"
const PRESS =
  "transition-[transform,background-color,color,border-color,opacity] duration-150 ease-out active:scale-[0.96]"
const HOVER_ROW = "[@media(hover:hover)]:hover:bg-white/[0.05]"

/* ------------------------------------------------------------------ */
/* Audio-unlock flag: browsers block sound until the page is touched.  */
/* ------------------------------------------------------------------ */

let needsTap = false
let unlockHandler: (() => void) | null = null
const tapListeners = new Set<() => void>()
function setNeedsTap(next: boolean) {
  if (needsTap === next) return
  needsTap = next
  for (const listener of tapListeners) listener()
}
function useNeedsTap() {
  return useSyncExternalStore(
    (listener) => {
      tapListeners.add(listener)
      return () => tapListeners.delete(listener)
    },
    () => needsTap,
    () => false
  )
}
function unlockMusic() {
  unlockHandler?.()
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

/**
 * Plays the room's music through a hidden YouTube player and keeps it within
 * a couple of seconds of the server clock. Mount once per room page, outside
 * any view that remounts, so songs keep playing between lobby and table.
 */
export function RoomMusic({ controller }: { controller: RoomMusicController }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadedQueueIdRef = useRef<string | null>(null)
  const reportedRef = useRef<string | null>(null)
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  const { volume, muted } = useMusicVolume()

  useEffect(() => {
    let cancelled = false
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return
        const mount = document.createElement("div")
        hostRef.current.appendChild(mount)
        playerRef.current = new YT.Player(mount, {
          width: 200,
          height: 200,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (import.meta.env.DEV)
                (
                  window as unknown as { __musicPlayer?: unknown }
                ).__musicPlayer = playerRef.current
              setReady(true)
            },
            onAutoplayBlocked: () => setNeedsTap(true),
            onStateChange: ({ data }) => {
              if (data === YT_STATE.PLAYING) setNeedsTap(false)
              const queueId = loadedQueueIdRef.current
              if (data === YT_STATE.ENDED && queueId) {
                controllerRef.current.reportEnded(queueId)
              }
            },
            onError: ({ data }) => {
              const queueId = loadedQueueIdRef.current
              // 2 = bad ID, 5 = HTML5 error, 100 = removed,
              // 101/150 = owner disallows embedding.
              if (!queueId || reportedRef.current === queueId) return
              if ([2, 5, 100, 101, 150].includes(data)) {
                reportedRef.current = queueId
                controllerRef.current.reportUnplayable(queueId)
              }
            },
          },
        })
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLoadError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
      loadedQueueIdRef.current = null
      setReady(false)
    }
  }, [])

  // The tap must call playVideo() synchronously inside the click.
  useEffect(() => {
    unlockHandler = () => {
      const player = playerRef.current
      if (!player) return
      player.unMute()
      player.playVideo()
      const snapshot = controllerRef.current.snapshot
      if (snapshot?.status === "playing") {
        player.seekTo(
          estimatePositionSec(snapshot, controllerRef.current.receivedAt),
          true
        )
      }
      setNeedsTap(false)
    }
    return () => {
      unlockHandler = null
      setNeedsTap(false)
    }
  }, [])

  const { snapshot, receivedAt } = controller

  // Follow the room: load a new song, pause, resume, or correct drift.
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player) return
    const nowPlaying = snapshot?.nowPlaying
    if (!snapshot || !nowPlaying) {
      if (loadedQueueIdRef.current) player.stopVideo()
      loadedQueueIdRef.current = null
      setNeedsTap(false)
      return
    }
    const expected = estimatePositionSec(snapshot, receivedAt)
    if (loadedQueueIdRef.current !== nowPlaying.queueId) {
      loadedQueueIdRef.current = nowPlaying.queueId
      const options = { videoId: nowPlaying.id, startSeconds: expected }
      if (snapshot.status === "playing") player.loadVideoById(options)
      else player.cueVideoById(options)
      return
    }
    if (snapshot.status === "paused") {
      player.pauseVideo()
      return
    }
    if (player.getPlayerState() !== YT_STATE.PLAYING) player.playVideo()
    if (Math.abs(player.getCurrentTime() - expected) > 2.5)
      player.seekTo(expected, true)
  }, [ready, snapshot, receivedAt])

  // Drift check + autoplay-blocked detection while a song should be playing.
  useEffect(() => {
    if (!ready || snapshot?.status !== "playing") return
    let stalledChecks = 0
    const interval = window.setInterval(() => {
      const player = playerRef.current
      const current = controllerRef.current
      if (!player || !current.snapshot) return
      const state = player.getPlayerState()
      if (
        state === YT_STATE.UNSTARTED ||
        state === YT_STATE.CUED ||
        state === YT_STATE.PAUSED
      ) {
        // Twice in a row, so a slow first load doesn't trigger the prompt.
        stalledChecks++
        if (stalledChecks >= 2) setNeedsTap(true)
        else player.playVideo()
        return
      }
      stalledChecks = 0
      if (state !== YT_STATE.PLAYING) return
      const expected = estimatePositionSec(current.snapshot, current.receivedAt)
      if (Math.abs(player.getCurrentTime() - expected) > 2.5)
        player.seekTo(expected, true)
    }, 2_500)
    return () => window.clearInterval(interval)
  }, [ready, snapshot?.status, snapshot?.nowPlaying?.queueId])

  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player) return
    player.setVolume(volume)
    if (muted) player.mute()
    else player.unMute()
  }, [ready, volume, muted])

  return (
    <>
      {/* Audio only: the video frame stays off-screen. */}
      <div
        ref={hostRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 -left-[10000px] size-[200px] opacity-0"
      />
      <MusicPanel controller={controller} loadError={loadError} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Header button                                                       */
/* ------------------------------------------------------------------ */

export function MusicButton({ compact = false }: { compact?: boolean }) {
  const controller = useMusicController()
  const panel = useMusicPanel()
  const tap = useNeedsTap()
  const status = controller?.snapshot?.status ?? "idle"
  const title = tap
    ? "Tap to hear the room's music"
    : status === "playing"
      ? `Music: ${controller?.snapshot?.nowPlaying?.title ?? "playing"}`
      : "Music"

  return (
    <button
      type="button"
      onClick={() => {
        if (tap) unlockMusic()
        panel.toggle()
      }}
      title={title}
      aria-label={title}
      aria-expanded={panel.open}
      className={
        "relative inline-flex shrink-0 items-center justify-center rounded-full border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 " +
        PRESS +
        " " +
        (compact ? "size-9" : "size-11") +
        " " +
        (panel.open || status === "playing"
          ? "border-violet-300/25 bg-violet-400/10 text-violet-100"
          : "border-white/10 bg-white/[0.045] text-white/74 [@media(hover:hover)]:hover:border-white/18 [@media(hover:hover)]:hover:bg-white/[0.075] [@media(hover:hover)]:hover:text-white/88")
      }
    >
      {status === "playing" && !tap ? (
        <EqualizerBars />
      ) : (
        <Music2 className="size-4" strokeWidth={2} />
      )}
      {tap && (
        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-violet-300 shadow-[0_0_0_2px_#070604] motion-safe:animate-pulse" />
      )}
    </button>
  )
}

function EqualizerBars() {
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-[2px]">
      {[0, 180, 360].map((delay) => (
        <span
          key={delay}
          className="w-[3px] origin-bottom rounded-full bg-current motion-safe:animate-[music-bar_900ms_ease-in-out_infinite_alternate]"
          style={{ height: "100%", animationDelay: `${delay}ms` }}
        />
      ))}
      <style>{`@keyframes music-bar{0%{transform:scaleY(.3)}100%{transform:scaleY(1)}}`}</style>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Library panel                                                       */
/* ------------------------------------------------------------------ */

type Tab = "search" | "queue" | "history" | "liked" | "playlists"

function MusicPanel({
  controller,
  loadError,
}: {
  controller: RoomMusicController
  loadError: string | null
}) {
  const panel = useMusicPanel()
  const [tab, setTab] = useState<Tab>("search")
  const snapshot = controller.snapshot
  const { liked } = useLikedSongs()

  useEffect(() => {
    if (!panel.open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") panel.setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel.open])

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "search", label: "Search" },
    { id: "queue", label: "Queue", count: snapshot?.queue.length },
    { id: "history", label: "History" },
    { id: "liked", label: "Liked", count: liked.length || undefined },
    { id: "playlists", label: "Playlists" },
  ]

  return (
    <>
      {/* Mobile scrim */}
      <div
        aria-hidden="true"
        onClick={() => panel.setOpen(false)}
        className={
          "fixed inset-0 z-[150] bg-black/50 transition-opacity duration-200 sm:hidden " +
          (panel.open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <section
        role="dialog"
        aria-label="Room music"
        aria-hidden={!panel.open}
        inert={!panel.open}
        className={
          "fixed z-[151] flex flex-col overflow-hidden border border-white/10 bg-[#0d0c0a]/96 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl will-change-transform " +
          "inset-x-0 bottom-0 max-h-[86dvh] rounded-t-3xl sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:max-h-none sm:w-[384px] sm:rounded-3xl " +
          `transition-[transform,opacity] duration-[260ms] ${EASE_OUT} motion-reduce:transition-opacity ` +
          (panel.open
            ? "translate-y-0 opacity-100 sm:translate-x-0"
            : "pointer-events-none translate-y-full opacity-0 motion-reduce:translate-x-0 motion-reduce:translate-y-0 sm:translate-x-[calc(100%+1rem)] sm:translate-y-0")
        }
      >
        <header className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Music2 className="size-4 text-violet-200" strokeWidth={2} />
            <h2 className="text-sm font-semibold tracking-tight text-white/90">
              Music
            </h2>
          </div>
          <IconButton label="Close music" onClick={() => panel.setOpen(false)}>
            <X className="size-4" strokeWidth={2} />
          </IconButton>
        </header>

        <NowPlaying controller={controller} loadError={loadError} />

        <nav
          aria-label="Music library"
          className="uno-scrollbar mx-4 mt-3 flex shrink-0 gap-1 overflow-x-auto"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-pressed={tab === item.id}
              className={
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium " +
                PRESS +
                " " +
                (tab === item.id
                  ? "bg-white text-neutral-950"
                  : "text-white/56 [@media(hover:hover)]:hover:bg-white/[0.06] [@media(hover:hover)]:hover:text-white/86")
              }
            >
              {item.label}
              {item.count ? (
                <span
                  className={
                    "tabular-nums " +
                    (tab === item.id ? "text-neutral-500" : "text-white/36")
                  }
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="uno-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {tab === "search" && (
            <SearchTab
              controller={controller}
              searchAvailable={snapshot?.searchAvailable ?? false}
            />
          )}
          {tab === "queue" && <QueueTab controller={controller} />}
          {tab === "history" && (
            <TrackList
              tracks={snapshot?.history ?? []}
              controller={controller}
              meta={(track) =>
                "requestedByName" in track
                  ? `${track.artist} · ${track.requestedByName as string}`
                  : track.artist
              }
              empty="Songs played in this room show up here."
            />
          )}
          {tab === "liked" && (
            <TrackList
              tracks={liked}
              controller={controller}
              empty="Tap ♥ on any song to keep it here. Liked songs stay in this browser across rooms."
            />
          )}
          {tab === "playlists" && <PlaylistsTab controller={controller} />}
        </div>

        {controller.error && (
          <p
            role="alert"
            className="mx-3 mb-3 flex items-start justify-between gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-100 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.2)]"
          >
            {controller.error}
            <button
              type="button"
              onClick={controller.clearError}
              aria-label="Dismiss"
              className="shrink-0 text-red-100/60 hover:text-red-100"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </p>
        )}
      </section>
    </>
  )
}

function NowPlaying({
  controller,
  loadError,
}: {
  controller: RoomMusicController
  loadError: string | null
}) {
  const snapshot = controller.snapshot
  const track = snapshot?.nowPlaying ?? null
  const tap = useNeedsTap()
  const { volume, muted, update } = useMusicVolume()
  const { isLiked, toggle } = useLikedSongs()

  if (!snapshot || !track) {
    return (
      <div className="mx-4 rounded-2xl bg-white/[0.035] px-4 py-5 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
        <p className="text-sm font-medium text-white/80">Nothing playing</p>
        <p className="mt-1 text-xs leading-relaxed text-white/44">
          Search below, or type{" "}
          <span className="font-semibold text-violet-200">@DJ play</span> and a
          song in chat.
        </p>
        {loadError && (
          <p className="mt-2 text-xs text-red-200/80">{loadError}</p>
        )}
      </div>
    )
  }

  const liked = isLiked(track.id)
  const playing = snapshot.status === "playing"

  return (
    <div className="mx-4 rounded-2xl bg-white/[0.035] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="flex items-center gap-3">
        <img
          src={track.thumbnailUrl}
          alt=""
          draggable={false}
          className="size-14 shrink-0 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white/92">
            {track.title}
          </p>
          <p className="truncate text-xs text-white/48">{track.artist}</p>
          <p className="mt-0.5 truncate text-[11px] text-white/34">
            Requested by {track.requestedByName}
          </p>
        </div>
        <IconButton
          label={liked ? "Unlike" : "Like"}
          pressed={liked}
          onClick={() => toggle(track)}
          className={liked ? "text-rose-300" : undefined}
        >
          <Heart
            className="size-4"
            strokeWidth={2}
            fill={liked ? "currentColor" : "none"}
          />
        </IconButton>
      </div>

      <Progress snapshot={snapshot} receivedAt={controller.receivedAt} />

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void controller.control(playing ? "pause" : "resume")}
          aria-label={playing ? "Pause for everyone" : "Resume for everyone"}
          title={playing ? "Pause for everyone" : "Resume for everyone"}
          className={
            "grid size-9 place-items-center rounded-full bg-white text-neutral-950 " +
            PRESS +
            " [@media(hover:hover)]:hover:bg-white/88"
          }
        >
          {playing ? (
            <Pause className="size-4" strokeWidth={2.2} fill="currentColor" />
          ) : (
            <Play
              className="size-4 translate-x-px"
              strokeWidth={2.2}
              fill="currentColor"
            />
          )}
        </button>
        <IconButton
          label="Skip for everyone"
          onClick={() => void controller.control("skip")}
        >
          <SkipForward className="size-4" strokeWidth={2} />
        </IconButton>
        <IconButton
          label="Stop and clear the queue"
          onClick={() => void controller.control("stop")}
        >
          <Square className="size-3.5" strokeWidth={2.2} />
        </IconButton>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label={muted ? "Unmute music (just you)" : "Mute music (just you)"}
            onClick={() => update({ muted: !muted })}
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" strokeWidth={2} />
            ) : (
              <Volume2 className="size-4" strokeWidth={2} />
            )}
          </IconButton>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(event) =>
              update({ volume: Number(event.target.value), muted: false })
            }
            aria-label="Music volume (just you)"
            className="h-1 w-20 cursor-pointer accent-white"
          />
        </div>
      </div>

      {tap && (
        <button
          type="button"
          onClick={unlockMusic}
          className={
            "mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-400/14 py-2 text-xs font-medium text-violet-100 shadow-[inset_0_0_0_1px_rgba(196,181,253,0.22)] " +
            PRESS +
            " [@media(hover:hover)]:hover:bg-violet-400/20"
          }
        >
          <Volume2 className="size-3.5" strokeWidth={2} />
          Your browser paused the sound. Tap to listen
        </button>
      )}
    </div>
  )
}

function Progress({
  snapshot,
  receivedAt,
}: {
  snapshot: RoomMusicSnapshot
  receivedAt: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (snapshot.status !== "playing") return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [snapshot.status])
  const position = estimatePositionSec(snapshot, receivedAt, now)
  const duration = snapshot.nowPlaying?.durationSec ?? null
  const ratio = duration ? Math.min(1, position / duration) : 0

  return (
    <div className="mt-3">
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full origin-left rounded-full bg-white/80 transition-transform duration-500 ease-linear"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/40 tabular-nums">
        <span>{formatTrackDuration(position)}</span>
        <span>{duration ? formatTrackDuration(duration) : "Live"}</span>
      </div>
    </div>
  )
}

function SearchTab({
  controller,
  searchAvailable,
}: {
  controller: RoomMusicController
  searchAvailable: boolean
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Array<MusicTrack> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Search on submit, not per keystroke: each search spends YouTube quota.
  async function submit() {
    const value = query.trim()
    if (!value) return
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    setLoading(true)
    setError(null)
    try {
      const found = await searchMusic(value, abort.signal)
      if (!abort.signal.aborted) setResults(found)
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!abort.signal.aborted) setLoading(false)
    }
  }

  return (
    <div className="px-2">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="relative mt-1"
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-white/36"
          strokeWidth={2}
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            searchAvailable
              ? "Song, artist, or YouTube link"
              : "Paste a YouTube link"
          }
          aria-label="Search songs"
          enterKeyHint="search"
          className="h-10 w-full rounded-xl border border-white/10 bg-black/30 pr-10 pl-8.5 text-sm text-white/88 transition-[border-color,background-color] duration-150 outline-none placeholder:text-white/30 focus:border-white/24 focus:bg-black/45"
        />
        {loading && (
          <LoaderCircle
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-white/50"
            strokeWidth={2}
          />
        )}
      </form>
      {!searchAvailable && (
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/40">
          Search by name needs YOUTUBE_API_KEY on the server. Links work without
          it.
        </p>
      )}
      {error && <p className="mt-3 px-1 text-xs text-red-200/90">{error}</p>}
      <div className="-mx-2 mt-2">
        {results === null ? (
          <Empty>Press Enter to search YouTube.</Empty>
        ) : (
          <TrackList
            tracks={results}
            controller={controller}
            empty="No playable results. Try different words."
          />
        )}
      </div>
    </div>
  )
}

function QueueTab({ controller }: { controller: RoomMusicController }) {
  const queue = controller.snapshot?.queue ?? []
  if (queue.length === 0)
    return <Empty>The queue is empty. Add songs from Search or History.</Empty>
  return (
    <ul>
      {queue.map((entry, index) => (
        <TrackRow
          key={entry.queueId}
          track={entry}
          leading={
            <span className="w-4 shrink-0 text-center text-[11px] text-white/34 tabular-nums">
              {index + 1}
            </span>
          }
          meta={`${entry.artist} · ${entry.requestedByName}`}
          actions={
            <IconButton
              label={`Remove ${entry.title} from the queue`}
              onClick={() => void controller.remove(entry.queueId)}
            >
              <X className="size-3.5" strokeWidth={2} />
            </IconButton>
          }
        />
      ))}
    </ul>
  )
}

function PlaylistsTab({ controller }: { controller: RoomMusicController }) {
  const playlists = controller.snapshot?.playlists ?? []
  const [name, setName] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const open = playlists.find((playlist) => playlist.id === openId) ?? null

  if (open) {
    return (
      <div>
        <div className="flex items-center gap-2 px-2 py-1">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className={"text-xs text-white/50 hover:text-white/86 " + PRESS}
          >
            ← Playlists
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white/90">
              {open.name}
            </p>
            <p className="text-[11px] text-white/40">
              {open.tracks.length} song{open.tracks.length === 1 ? "" : "s"} ·
              by {open.createdByName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={open.tracks.length === 0}
              onClick={() => void controller.playPlaylist(open.id)}
              className={
                "flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-neutral-950 disabled:opacity-40 " +
                PRESS
              }
            >
              <Play className="size-3" strokeWidth={2.4} fill="currentColor" />
              Queue all
            </button>
            <IconButton
              label={`Delete ${open.name}`}
              onClick={async () => {
                if (await controller.deletePlaylist(open.id)) setOpenId(null)
              }}
            >
              <Trash2 className="size-3.5" strokeWidth={2} />
            </IconButton>
          </div>
        </div>
        {open.tracks.length === 0 ? (
          <Empty>
            Add songs with the <ListPlus className="inline size-3" /> button on
            any song.
          </Empty>
        ) : (
          <TrackList
            tracks={open.tracks}
            controller={controller}
            extraAction={(track) => (
              <IconButton
                label={`Remove ${track.title} from ${open.name}`}
                onClick={() =>
                  void controller.removeFromPlaylist(open.id, track.id)
                }
              >
                <X className="size-3.5" strokeWidth={2} />
              </IconButton>
            )}
            hidePlaylistAction
            empty=""
          />
        )}
      </div>
    )
  }

  return (
    <div className="px-2">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return
          if (await controller.createPlaylist(name)) setName("")
        }}
        className="mt-1 flex gap-1.5"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="New room playlist"
          aria-label="New playlist name"
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/88 transition-[border-color,background-color] duration-150 outline-none placeholder:text-white/30 focus:border-white/24 focus:bg-black/45"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          aria-label="Create playlist"
          className={
            "grid size-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-950 disabled:opacity-30 " +
            PRESS
          }
        >
          <Plus className="size-4" strokeWidth={2.2} />
        </button>
      </form>
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/40">
        Everyone in the room can add to these. Play one from chat with{" "}
        <span className="text-violet-200">@DJ playlist name</span>.
      </p>
      {playlists.length === 0 ? (
        <Empty>No playlists yet.</Empty>
      ) : (
        <ul className="-mx-2 mt-2">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                onClick={() => setOpenId(playlist.id)}
                className={
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left " +
                  HOVER_ROW +
                  " transition-colors duration-150"
                }
              >
                <PlaylistCover playlist={playlist} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/88">
                    {playlist.name}
                  </p>
                  <p className="truncate text-[11px] text-white/40">
                    {playlist.tracks.length} song
                    {playlist.tracks.length === 1 ? "" : "s"} ·{" "}
                    {playlist.createdByName}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PlaylistCover({ playlist }: { playlist: RoomPlaylist }) {
  const first = playlist.tracks.at(0)
  return first ? (
    <img
      src={first.thumbnailUrl}
      alt=""
      draggable={false}
      className="size-10 shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-white/10"
    />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-white/40">
      <ListMusic className="size-4" strokeWidth={2} />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Track rows                                                          */
/* ------------------------------------------------------------------ */

function TrackList({
  tracks,
  controller,
  empty,
  meta,
  extraAction,
  hidePlaylistAction = false,
}: {
  tracks: Array<MusicTrack>
  controller: RoomMusicController
  empty: string
  meta?: (track: MusicTrack) => string
  extraAction?: (track: MusicTrack) => ReactNode
  hidePlaylistAction?: boolean
}) {
  if (tracks.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul>
      {tracks.map((track, index) => (
        <TrackRow
          key={`${track.id}-${index}`}
          track={track}
          meta={meta?.(track)}
          actions={
            <>
              {extraAction?.(track)}
              <TrackActions
                track={track}
                controller={controller}
                hidePlaylistAction={hidePlaylistAction}
              />
            </>
          }
        />
      ))}
    </ul>
  )
}

function TrackRow({
  track,
  meta,
  leading,
  actions,
}: {
  track: MusicTrack | QueuedTrack
  meta?: string
  leading?: ReactNode
  actions?: ReactNode
}) {
  return (
    <li
      className={
        "group/track flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-150 " +
        HOVER_ROW
      }
    >
      {leading}
      <img
        src={track.thumbnailUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-10 shrink-0 rounded-lg object-cover outline outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-medium text-white/88">
          {track.title}
        </p>
        <p className="truncate text-[11px] leading-4 text-white/42">
          {meta ?? track.artist} · {formatTrackDuration(track.durationSec)}
        </p>
      </div>
      <div className="flex shrink-0 items-center">{actions}</div>
    </li>
  )
}

function TrackActions({
  track,
  controller,
  hidePlaylistAction,
}: {
  track: MusicTrack
  controller: RoomMusicController
  hidePlaylistAction: boolean
}) {
  const { isLiked, toggle } = useLikedSongs()
  const [queued, setQueued] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const liked = isLiked(track.id)
  const playlists = controller.snapshot?.playlists ?? []

  useEffect(() => {
    if (!queued) return
    const id = window.setTimeout(() => setQueued(false), 1_600)
    return () => window.clearTimeout(id)
  }, [queued])

  return (
    <div className="relative flex items-center">
      <IconButton
        label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
        pressed={liked}
        onClick={() => toggle(track)}
        className={liked ? "text-rose-300" : undefined}
      >
        <Heart
          className="size-3.5"
          strokeWidth={2}
          fill={liked ? "currentColor" : "none"}
        />
      </IconButton>
      {!hidePlaylistAction && (
        <IconButton
          label={`Add ${track.title} to a playlist`}
          pressed={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ListPlus className="size-3.5" strokeWidth={2} />
        </IconButton>
      )}
      <IconButton
        label={queued ? "Queued" : `Queue ${track.title}`}
        onClick={async () => {
          if (await controller.enqueue(track.id)) setQueued(true)
        }}
        className={queued ? "text-violet-200" : undefined}
      >
        {queued ? (
          <Check className="size-3.5" strokeWidth={2.2} />
        ) : (
          <Plus className="size-3.5" strokeWidth={2.2} />
        )}
      </IconButton>

      {menuOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 mt-1 w-48 origin-top-right rounded-xl border border-white/10 bg-neutral-950 p-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)] motion-safe:animate-[music-pop_160ms_cubic-bezier(0.23,1,0.32,1)]"
        >
          <style>{`@keyframes music-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setMenuOpen(false)
              if (await controller.enqueue(track.id, true)) setQueued(true)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-white/80 hover:bg-white/[0.07]"
          >
            <ListStart className="size-3.5" strokeWidth={2} />
            Play next
          </button>
          {playlists.length > 0 && <div className="my-1 h-px bg-white/8" />}
          {playlists.map((playlist) => {
            const inPlaylist = playlist.tracks.some(
              (item) => item.id === track.id
            )
            return (
              <button
                key={playlist.id}
                type="button"
                role="menuitem"
                disabled={inPlaylist}
                onClick={async () => {
                  setMenuOpen(false)
                  await controller.addToPlaylist(playlist.id, track.id)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-white/80 hover:bg-white/[0.07] disabled:text-white/34 disabled:hover:bg-transparent"
              >
                {inPlaylist ? (
                  <Check className="size-3.5" strokeWidth={2} />
                ) : (
                  <ListMusic className="size-3.5" strokeWidth={2} />
                )}
                <span className="truncate">{playlist.name}</span>
              </button>
            )
          })}
          {playlists.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] leading-relaxed text-white/40">
              Create a playlist in the Playlists tab to save songs for the room.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function IconButton({
  label,
  onClick,
  children,
  pressed,
  className,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={
        "grid size-8 shrink-0 place-items-center rounded-full " +
        PRESS +
        " " +
        (className ??
          "text-white/50 [@media(hover:hover)]:hover:bg-white/[0.07] [@media(hover:hover)]:hover:text-white/88")
      }
    >
      {children}
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-xs leading-relaxed text-white/38">
      {children}
    </p>
  )
}
