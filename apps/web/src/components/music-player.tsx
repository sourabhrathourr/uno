import {
  ArrowLeft,
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
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react"

import type { RoomMusicController } from "@/lib/room-music"
import type { YouTubePlayer } from "@/lib/youtube-player"
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ON } from "@/components/toolbar"
import {
  estimatePositionSec,
  searchMusic,
  useLikedSongs,
  useMusicController,
  useMusicPanel,
  useMusicVolume,
  useSongLike,
} from "@/lib/room-music"
import { YT_STATE, loadYouTubeApi } from "@/lib/youtube-player"

/** iOS-style sheet curve: fast out, long settle. */
const EASE_DRAWER = "ease-[cubic-bezier(0.32,0.72,0,1)]"
const PRESS =
  "transition-[transform,background-color,color,opacity] duration-150 ease-out active:scale-[0.96]"
const HOVER = "[@media(hover:hover)]:hover:bg-white/[0.06]"
const ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded-full text-white/50 " +
  PRESS +
  " [@media(hover:hover)]:hover:bg-white/[0.07] [@media(hover:hover)]:hover:text-white/90"
const INPUT =
  "h-11 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] text-base text-white/90 transition-[border-color,background-color] duration-150 outline-none placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.06] sm:h-10 sm:rounded-xl sm:text-sm"

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
  const { isLiked } = useLikedSongs()

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

  // A song you liked in another room counts as liked here too, so the room
  // sees your heart on it as soon as it plays.
  const nowPlayingId = snapshot?.nowPlaying?.id
  const selfId = controller.selfPlayerId
  useEffect(() => {
    if (!nowPlayingId || !selfId || !isLiked(nowPlayingId)) return
    const likers = controllerRef.current.snapshot?.likes[nowPlayingId] ?? []
    if (!likers.some((liker) => liker.playerId === selfId))
      void controllerRef.current.like(nowPlayingId, true)
  }, [nowPlayingId, selfId, isLiked])

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

export function MusicButton() {
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
        TOOLBAR_BUTTON +
        (panel.open || status === "playing" ? " " + TOOLBAR_BUTTON_ON : "")
      }
    >
      {status === "playing" && !tap ? (
        <EqualizerBars />
      ) : (
        <Music2 className="size-4" strokeWidth={2} />
      )}
      {tap && (
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-white motion-safe:animate-pulse" />
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
          className="h-full w-[3px] origin-bottom rounded-full bg-current motion-safe:animate-[music-bar_900ms_ease-in-out_infinite_alternate]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
      <style>{`@keyframes music-bar{0%{transform:scaleY(.3)}100%{transform:scaleY(1)}}`}</style>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Library panel: a right-side panel on desktop, a bottom sheet on     */
/* phones that can be swiped down to close.                            */
/* ------------------------------------------------------------------ */

type Tab = "search" | "queue" | "history" | "liked" | "playlists"

function useSheetDrag(onDismiss: () => void) {
  const sheetRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{
    id: number
    startY: number
    startedAt: number
    dy: number
  } | null>(null)

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const sheet = sheetRef.current
    if (!sheet || drag.current) return // ignore a second finger
    if (!window.matchMedia("(max-width: 639px)").matches) return
    if ((event.target as HTMLElement).closest("button,input,a")) return
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      startedAt: performance.now(),
      dy: 0,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    sheet.style.transition = "none"
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current
    const sheet = sheetRef.current
    if (!current || !sheet || current.id !== event.pointerId) return
    const raw = event.clientY - current.startY
    // Past the top it resists instead of hitting a wall.
    const dy = raw < 0 ? -Math.sqrt(-raw) * 2 : raw
    current.dy = dy
    sheet.style.transform = `translateY(${dy}px)`
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current
    const sheet = sheetRef.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null
    const velocity =
      current.dy / Math.max(1, performance.now() - current.startedAt)
    if (sheet) {
      // Hand back to the CSS transition so it settles from where it is.
      sheet.style.transition = ""
      sheet.style.transform = ""
    }
    if (current.dy > 120 || (current.dy > 12 && velocity > 0.11)) onDismiss()
  }

  return {
    sheetRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
  }
}

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
  const { sheetRef, handlers } = useSheetDrag(() => panel.setOpen(false))

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
    { id: "liked", label: "Liked", count: liked.length },
    { id: "playlists", label: "Playlists" },
  ]

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => panel.setOpen(false)}
        className={
          "fixed inset-0 z-[150] bg-black/55 backdrop-blur-[2px] transition-opacity duration-300 sm:hidden " +
          (panel.open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-label="Room music"
        aria-hidden={!panel.open}
        inert={!panel.open}
        className={
          "fixed z-[151] flex flex-col overflow-hidden bg-[#0f0e0c] text-white will-change-transform " +
          // Phone: bottom sheet. Desktop: floating side panel.
          "inset-x-0 bottom-0 h-[min(88dvh,760px)] rounded-t-[28px] border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_80px_rgba(0,0,0,0.6)] " +
          "sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:h-auto sm:w-[384px] sm:rounded-3xl sm:border sm:border-white/10 sm:pb-0 sm:shadow-[0_24px_80px_rgba(0,0,0,0.55)] " +
          `transition-[transform,opacity] duration-[320ms] ${EASE_DRAWER} motion-reduce:transition-opacity sm:duration-[240ms] ` +
          (panel.open
            ? "translate-y-0 opacity-100 sm:translate-x-0"
            : "pointer-events-none translate-y-full motion-reduce:translate-x-0 motion-reduce:translate-y-0 motion-reduce:opacity-0 sm:translate-x-[calc(100%+1rem)] sm:translate-y-0 sm:opacity-0")
        }
      >
        {/* Drag zone: handle + title. */}
        <div {...handlers} className="shrink-0 touch-none select-none">
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-white/20 sm:hidden"
          />
          <header className="flex items-center justify-between px-5 pt-3 pb-3 sm:px-4 sm:pt-4">
            <h2 className="text-[15px] font-semibold tracking-tight text-white/92 sm:text-sm">
              Music
            </h2>
            <button
              type="button"
              onClick={() => panel.setOpen(false)}
              aria-label="Close music"
              className={ICON_BUTTON + " -mr-1.5"}
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </header>
        </div>

        <NowPlaying controller={controller} loadError={loadError} />

        <nav aria-label="Music library" className="mt-4 shrink-0 px-4 sm:mt-3">
          <div className="flex w-full gap-0.5 rounded-full bg-white/[0.04] p-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={
                  "flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1 text-[13px] font-medium sm:text-xs " +
                  PRESS +
                  " " +
                  (tab === item.id
                    ? "bg-white text-neutral-950 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                    : "text-white/55 [@media(hover:hover)]:hover:text-white/88")
                }
              >
                {item.label}
                {item.count ? (
                  <span
                    className={
                      "text-[11px] tabular-nums " +
                      (tab === item.id ? "text-neutral-500" : "text-white/35")
                    }
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </nav>

        <div className="uno-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
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
              empty="Songs played in this room show up here."
            />
          )}
          {tab === "liked" && (
            <TrackList
              tracks={liked}
              controller={controller}
              empty="Tap ♥ on any song to keep it here. Your liked songs follow you to every room."
            />
          )}
          {tab === "playlists" && <PlaylistsTab controller={controller} />}
        </div>

        {controller.error && (
          <p
            role="alert"
            className="mx-3 mb-3 flex items-start justify-between gap-2 rounded-2xl bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-100 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.18)]"
          >
            {controller.error}
            <button
              type="button"
              onClick={controller.clearError}
              aria-label="Dismiss"
              className="-m-1 grid size-6 shrink-0 place-items-center text-red-100/60 hover:text-red-100"
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
  const track = controller.snapshot?.nowPlaying ?? null
  if (!controller.snapshot || !track) {
    return (
      <div className="mx-4 flex items-center gap-3 rounded-[22px] bg-white/[0.035] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-white/40">
          <Music2 className="size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/85">Nothing playing</p>
          <p className="mt-0.5 text-xs leading-relaxed text-white/42">
            Search below, or tag{" "}
            <span className="font-medium text-white/70">@DJ</span> in chat.
          </p>
          {loadError && (
            <p className="mt-1 text-xs text-red-200/80">{loadError}</p>
          )}
        </div>
      </div>
    )
  }
  return (
    <NowPlayingCard
      controller={controller}
      snapshot={controller.snapshot}
      track={track}
    />
  )
}

function NowPlayingCard({
  controller,
  snapshot,
  track,
}: {
  controller: RoomMusicController
  snapshot: RoomMusicSnapshot
  track: QueuedTrack
}) {
  const tap = useNeedsTap()
  const { volume, muted, update } = useMusicVolume()
  const like = useSongLike(track)
  const playing = snapshot.status === "playing"

  return (
    <div className="mx-4 rounded-[22px] bg-white/[0.035] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
      <div className="flex items-center gap-3">
        <img
          src={track.thumbnailUrl}
          alt=""
          draggable={false}
          className="size-14 shrink-0 rounded-2xl object-cover outline outline-1 -outline-offset-1 outline-white/10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-5 font-semibold text-white/94 sm:text-sm">
            {track.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {track.artist}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-white/34">
            {like.label ?? `Requested by ${track.requestedByName}`}
          </p>
        </div>
        <LikeButton like={like} title={track.title} />
      </div>

      <Progress snapshot={snapshot} receivedAt={controller.receivedAt} />

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => update({ muted: !muted })}
            aria-label={muted ? "Unmute music for you" : "Mute music for you"}
            title={muted ? "Unmute (just you)" : "Mute (just you)"}
            className={ICON_BUTTON}
          >
            {muted || volume === 0 ? (
              <VolumeX className="size-4" strokeWidth={2} />
            ) : (
              <Volume2 className="size-4" strokeWidth={2} />
            )}
          </button>
          {/* Phones have hardware volume keys; the slider is for desktops. */}
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(event) =>
              update({ volume: Number(event.target.value), muted: false })
            }
            aria-label="Music volume (just you)"
            className="hidden h-1 w-16 cursor-pointer accent-white sm:block"
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void controller.control("stop")}
            aria-label="Stop and clear the queue"
            title="Stop and clear the queue"
            className={ICON_BUTTON}
          >
            <Square className="size-3.5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() =>
              void controller.control(playing ? "pause" : "resume")
            }
            aria-label={playing ? "Pause for everyone" : "Play for everyone"}
            title={playing ? "Pause for everyone" : "Play for everyone"}
            className={
              "grid size-11 place-items-center rounded-full bg-white text-neutral-950 shadow-[0_6px_18px_rgba(0,0,0,0.35)] " +
              PRESS +
              " [@media(hover:hover)]:hover:bg-white/90"
            }
          >
            {playing ? (
              <Pause
                className="size-[18px]"
                strokeWidth={2.2}
                fill="currentColor"
              />
            ) : (
              <Play
                className="size-[18px] translate-x-px"
                strokeWidth={2.2}
                fill="currentColor"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => void controller.control("skip")}
            aria-label="Skip for everyone"
            title="Skip for everyone"
            className={ICON_BUTTON}
          >
            <SkipForward
              className="size-4"
              strokeWidth={2}
              fill="currentColor"
            />
          </button>
        </div>

        {/* Balances the volume group so the transport sits centred. */}
        <div className="w-9 sm:w-[100px]" aria-hidden="true" />
      </div>

      {tap && (
        <button
          type="button"
          onClick={unlockMusic}
          className={
            "mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[13px] font-medium text-neutral-950 " +
            PRESS
          }
        >
          <Volume2 className="size-4" strokeWidth={2} />
          Tap to listen
        </button>
      )}
    </div>
  )
}

function LikeButton({
  like,
  title,
  small = false,
}: {
  like: ReturnType<typeof useSongLike>
  title: string
  small?: boolean
}) {
  // Show a count only once someone besides you has liked it.
  const showCount = like.likers.length > (like.liked ? 1 : 0)
  return (
    <button
      type="button"
      onClick={like.toggle}
      aria-pressed={like.liked}
      aria-label={
        (like.liked ? `Unlike ${title}` : `Like ${title}`) +
        (like.label ? `. ${like.label}` : "")
      }
      title={like.label ?? (like.liked ? "Unlike" : "Like")}
      className={
        "flex h-9 shrink-0 items-center justify-center gap-1 rounded-full text-[11px] font-medium tabular-nums " +
        (showCount ? "px-2.5 " : "w-9 ") +
        PRESS +
        " [@media(hover:hover)]:hover:bg-white/[0.07] " +
        (like.liked
          ? "text-rose-300"
          : "text-white/45 [@media(hover:hover)]:hover:text-white/90")
      }
    >
      <Heart
        className={small ? "size-3.5" : "size-4"}
        strokeWidth={2}
        fill={like.liked ? "currentColor" : "none"}
      />
      {showCount && <span>{like.likers.length}</span>}
    </button>
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
    <div className="mt-3.5">
      <div className="h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full origin-left rounded-full bg-white/85 transition-transform duration-500 ease-linear"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-white/38 tabular-nums">
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
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          ;(document.activeElement as HTMLElement | null)?.blur()
          void submit()
        }}
        className="relative mt-1"
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-white/35"
          strokeWidth={2}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            searchAvailable
              ? "Songs, artists, or a YouTube link"
              : "Paste a YouTube link"
          }
          aria-label="Search songs"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={
            INPUT + " pr-10 pl-10 [&::-webkit-search-cancel-button]:hidden"
          }
        />
        {loading && (
          <LoaderCircle
            className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-white/50"
            strokeWidth={2}
          />
        )}
      </form>
      {!searchAvailable && (
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/40">
          Searching by name needs a YouTube API key on the server. Links work
          without it.
        </p>
      )}
      {error && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-red-200/90">
          {error}
        </p>
      )}
      <div className="-mx-2 mt-2">
        {results === null ? (
          <Empty>Find anything on YouTube and queue it for the room.</Empty>
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
    return <Empty>Up next is empty. Add songs from Search or History.</Empty>
  return (
    <ul>
      {queue.map((entry, index) => (
        <TrackRow
          key={entry.queueId}
          track={entry}
          leading={
            <span className="w-5 shrink-0 text-center text-xs text-white/32 tabular-nums">
              {index + 1}
            </span>
          }
          meta={`${entry.artist} · ${entry.requestedByName}`}
          actions={
            <button
              type="button"
              onClick={() => void controller.remove(entry.queueId)}
              aria-label={`Remove ${entry.title} from the queue`}
              title="Remove"
              className={ICON_BUTTON}
            >
              <X className="size-4" strokeWidth={2} />
            </button>
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
        <div className="flex items-center gap-2 px-2 pt-1 pb-3">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            aria-label="Back to playlists"
            className={ICON_BUTTON + " -ml-1"}
          >
            <ArrowLeft className="size-4" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white/92">
              {open.name}
            </p>
            <p className="text-[11px] text-white/40">
              {open.tracks.length} song{open.tracks.length === 1 ? "" : "s"} ·{" "}
              {open.createdByName}
            </p>
          </div>
          <button
            type="button"
            disabled={open.tracks.length === 0}
            onClick={() => void controller.playPlaylist(open.id)}
            className={
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-neutral-950 disabled:opacity-30 " +
              PRESS
            }
          >
            <Play className="size-3" strokeWidth={2.4} fill="currentColor" />
            Play
          </button>
          <button
            type="button"
            aria-label={`Delete ${open.name}`}
            title="Delete playlist"
            onClick={async () => {
              if (await controller.deletePlaylist(open.id)) setOpenId(null)
            }}
            className={ICON_BUTTON}
          >
            <Trash2 className="size-4" strokeWidth={2} />
          </button>
        </div>
        <TrackList
          tracks={open.tracks}
          controller={controller}
          empty="Add songs from any list with the playlist button."
          remove={{
            label: `Remove from ${open.name}`,
            onRemove: (track) =>
              void controller.removeFromPlaylist(open.id, track.id),
          }}
        />
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
        className="mt-1 flex gap-2"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
          placeholder="New room playlist"
          aria-label="New playlist name"
          enterKeyHint="done"
          className={INPUT + " min-w-0 flex-1 px-3.5"}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          aria-label="Create playlist"
          className={
            "grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-neutral-950 disabled:opacity-25 sm:size-10 sm:rounded-xl " +
            PRESS
          }
        >
          <Plus className="size-4" strokeWidth={2.4} />
        </button>
      </form>
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-white/40">
        Anyone in the room can add songs. Play one from chat with{" "}
        <span className="text-white/70">@DJ playlist name</span>.
      </p>
      {playlists.length === 0 ? (
        <Empty>No playlists yet.</Empty>
      ) : (
        <ul className="-mx-2 mt-3">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                onClick={() => setOpenId(playlist.id)}
                className={
                  "flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors duration-150 " +
                  HOVER
                }
              >
                <PlaylistCover playlist={playlist} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/90">
                    {playlist.name}
                  </p>
                  <p className="truncate text-xs text-white/40">
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
      className="size-12 shrink-0 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10"
    />
  ) : (
    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/40">
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
  remove,
}: {
  tracks: Array<MusicTrack>
  controller: RoomMusicController
  empty: string
  remove?: { label: string; onRemove: (track: MusicTrack) => void }
}) {
  if (tracks.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul>
      {tracks.map((track, index) => (
        <TrackRow
          key={`${track.id}-${index}`}
          track={track}
          actions={
            <TrackActions
              track={track}
              controller={controller}
              remove={remove}
            />
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
        "flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors duration-150 " +
        HOVER
      }
    >
      {leading}
      <img
        src={track.thumbnailUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="size-11 shrink-0 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-medium text-white/90 sm:text-[13px]">
          {track.title}
        </p>
        <p className="truncate text-xs leading-4 text-white/42 sm:text-[11px]">
          {meta ?? track.artist} · {formatTrackDuration(track.durationSec)}
        </p>
      </div>
      <div className="-mr-1 flex shrink-0 items-center">{actions}</div>
    </li>
  )
}

function TrackActions({
  track,
  controller,
  remove,
}: {
  track: MusicTrack
  controller: RoomMusicController
  remove?: { label: string; onRemove: (track: MusicTrack) => void }
}) {
  const like = useSongLike(track)
  const [queued, setQueued] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const playlists = controller.snapshot?.playlists ?? []

  useEffect(() => {
    if (!queued) return
    const id = window.setTimeout(() => setQueued(false), 1_600)
    return () => window.clearTimeout(id)
  }, [queued])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        setMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [menuOpen])

  return (
    <div ref={menuRef} className="relative flex items-center">
      <LikeButton like={like} title={track.title} small />
      {remove ? (
        <button
          type="button"
          onClick={() => remove.onRemove(track)}
          aria-label={`${remove.label}: ${track.title}`}
          title={remove.label}
          className={ICON_BUTTON}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={`More for ${track.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Play next or add to a playlist"
          className={
            ICON_BUTTON + (menuOpen ? " bg-white/[0.08] text-white" : "")
          }
        >
          <ListPlus className="size-4" strokeWidth={2} />
        </button>
      )}
      <button
        type="button"
        onClick={async () => {
          if (await controller.enqueue(track.id)) setQueued(true)
        }}
        aria-label={
          queued ? "Added to the queue" : `Add ${track.title} to the queue`
        }
        title={queued ? "Added" : "Add to queue"}
        className={ICON_BUTTON + (queued ? " text-white" : "")}
      >
        {queued ? (
          <Check className="size-4" strokeWidth={2.4} />
        ) : (
          <Plus className="size-4" strokeWidth={2.2} />
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 mt-1 w-52 origin-top-right rounded-2xl border border-white/10 bg-[#161512] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)] motion-safe:animate-[music-pop_160ms_cubic-bezier(0.23,1,0.32,1)]"
        >
          <style>{`@keyframes music-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
          <MenuItem
            icon={<ListStart className="size-4" strokeWidth={2} />}
            onClick={async () => {
              setMenuOpen(false)
              if (await controller.enqueue(track.id, true)) setQueued(true)
            }}
          >
            Play next
          </MenuItem>
          <div className="mx-2 my-1 h-px bg-white/[0.07]" />
          <p className="px-2.5 pt-1 pb-1 text-[10px] font-medium tracking-wide text-white/35 uppercase">
            Add to playlist
          </p>
          {playlists.length === 0 && (
            <p className="px-2.5 pb-2 text-xs leading-relaxed text-white/40">
              Create one in the Playlists tab.
            </p>
          )}
          {playlists.map((playlist) => {
            const inPlaylist = playlist.tracks.some(
              (item) => item.id === track.id
            )
            return (
              <MenuItem
                key={playlist.id}
                disabled={inPlaylist}
                icon={
                  inPlaylist ? (
                    <Check className="size-4" strokeWidth={2} />
                  ) : (
                    <ListMusic className="size-4" strokeWidth={2} />
                  )
                }
                onClick={async () => {
                  setMenuOpen(false)
                  await controller.addToPlaylist(playlist.id, track.id)
                }}
              >
                {playlist.name}
              </MenuItem>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function MenuItem({
  icon,
  children,
  onClick,
  disabled = false,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] text-white/82 transition-colors duration-150 disabled:text-white/32 [@media(hover:hover)]:hover:bg-white/[0.07] [@media(hover:hover)]:disabled:hover:bg-transparent"
    >
      <span className="shrink-0 text-white/50">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto max-w-[17rem] px-4 py-10 text-center text-[13px] leading-relaxed text-white/38 sm:text-xs">
      {children}
    </p>
  )
}
