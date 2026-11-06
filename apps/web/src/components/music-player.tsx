import {
  Check,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Search,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { formatTrackDuration } from "@workspace/game"
import type {
  MusicTrack,
  QueuedTrack,
  RoomMusicSnapshot,
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
/** Level the mute button restores when the slider was dragged to zero. */
const UNMUTE_VOLUME = 50

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
    // A fresh snapshot may carry a seek, so follow it closely here; the
    // periodic drift check below stays looser.
    const off = Math.abs(player.getCurrentTime() - expected) > 1
    if (snapshot.status === "paused") {
      player.pauseVideo()
      if (off) player.seekTo(expected, true)
      return
    }
    if (player.getPlayerState() !== YT_STATE.PLAYING) player.playVideo()
    if (off) player.seekTo(expected, true)
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
    // Volume 0 must mute: YouTube's unMute() can restore its last non-zero
    // level, so setVolume(0) + unMute() kept playing quietly.
    if (muted || volume === 0) {
      player.mute()
      return
    }
    player.unMute()
    player.setVolume(volume)
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

type Tab = "search" | "queue" | "history" | "liked"

type SlotRect = { top: number; left: number; width: number; height: number }

function measureChatSlot(): SlotRect | null {
  for (const node of document.querySelectorAll<HTMLElement>(
    "[data-music-anchor]"
  )) {
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
    }
  }
  return null
}

function sameRect(a: SlotRect | null, b: SlotRect | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  )
}

/**
 * Where the room chat sits on screen, so the music panel can take over that
 * exact slot. Null when no chat is visible (phones use the bottom sheet).
 * Tracks the slot every frame while open — the chat grid reflows when the
 * panel opens, on resize, and when the table's layout shifts.
 */
function useChatSlotRect(open: boolean) {
  const [rect, setRect] = useState<SlotRect | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    let last: SlotRect | null = null
    const tick = () => {
      const next = measureChatSlot()
      if (!sameRect(last, next)) {
        last = next
        setRect(next)
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [open])

  return rect
}

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
  const slot = useChatSlotRect(panel.open)

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
        style={slot ?? undefined}
        className={
          "fixed z-[151] flex flex-col overflow-hidden bg-[#0f0e0c] text-white will-change-transform " +
          `transition-[transform,opacity] duration-[320ms] ${EASE_DRAWER} motion-reduce:transition-opacity sm:duration-[240ms] ` +
          (slot
            ? // Desktop: sits exactly over the room chat, same size and shape.
              "rounded-2xl border border-white/10 shadow-[0_18px_56px_rgba(0,0,0,0.28)] " +
              (panel.open
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-2 opacity-0 motion-reduce:translate-y-0")
            : // Phone: bottom sheet. No chat column: floating side panel.
              "inset-x-0 bottom-0 h-[min(88dvh,760px)] rounded-t-[28px] border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_80px_rgba(0,0,0,0.6)] " +
              "sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:h-auto sm:w-[384px] sm:rounded-3xl sm:border sm:border-white/10 sm:pb-0 sm:shadow-[0_24px_80px_rgba(0,0,0,0.55)] " +
              (panel.open
                ? "translate-y-0 opacity-100 sm:translate-x-0"
                : "pointer-events-none translate-y-full motion-reduce:translate-x-0 motion-reduce:translate-y-0 motion-reduce:opacity-0 sm:translate-x-[calc(100%+1rem)] sm:translate-y-0 sm:opacity-0"))
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
              showLikers
              empty="Tap ♥ on any song to keep it here. Your liked songs follow you to every room."
            />
          )}
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
  const silent = muted || volume === 0
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

      <Progress
        snapshot={snapshot}
        receivedAt={controller.receivedAt}
        onSeek={controller.seek}
      />

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              silent
                ? // Slid to zero: unmuting needs a level you can hear.
                  update({
                    muted: false,
                    volume: volume === 0 ? UNMUTE_VOLUME : volume,
                  })
                : update({ muted: true })
            }
            aria-label={silent ? "Unmute music for you" : "Mute music for you"}
            title={silent ? "Unmute (just you)" : "Mute (just you)"}
            className={ICON_BUTTON}
          >
            {silent ? (
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
  onSeek,
}: {
  snapshot: RoomMusicSnapshot
  receivedAt: number
  onSeek: (positionSec: number) => Promise<boolean>
}) {
  const [now, setNow] = useState(() => Date.now())
  // Where the thumb is while you drag; the room only moves on release.
  const [scrub, setScrub] = useState<number | null>(null)
  useEffect(() => {
    if (snapshot.status !== "playing") return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [snapshot.status])
  const position = scrub ?? estimatePositionSec(snapshot, receivedAt, now)
  const duration = snapshot.nowPlaying?.durationSec ?? null
  const ratio = duration ? Math.min(1, position / duration) : 0
  const seekable = duration !== null && duration > 0
  const easing = scrub === null ? " duration-500 ease-linear" : " duration-0"

  async function commit() {
    if (scrub === null) return
    await onSeek(scrub)
    // The ack has already applied the new snapshot, so the bar won't jump.
    setScrub(null)
  }

  return (
    <div className="mt-2">
      <div className="group relative flex h-4 items-center">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10 transition-[height] duration-150 group-hover:h-[5px] group-has-[:focus-visible]:h-[5px]">
          <div
            className={
              "h-full origin-left rounded-full bg-white/85 transition-transform" +
              easing
            }
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
        {seekable && (
          <>
            <span
              aria-hidden="true"
              className={
                "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] transition-[left,opacity]" +
                easing +
                (scrub === null
                  ? " opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
                  : " opacity-100")
              }
              style={{ left: `${ratio * 100}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.floor(duration)}
              step={1}
              value={Math.round(position)}
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={() => void commit()}
              onPointerCancel={() => void commit()}
              onKeyUp={() => void commit()}
              aria-label="Seek (moves the song for everyone)"
              aria-valuetext={`${formatTrackDuration(position)} of ${formatTrackDuration(duration)}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </>
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-white/38 tabular-nums">
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
            showLike={false}
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

function TrackList({
  tracks,
  controller,
  empty,
  showLike = true,
  showLikers = false,
}: {
  tracks: Array<MusicTrack>
  controller: RoomMusicController
  empty: string
  /** Search results skip the heart; liking happens from what's playing. */
  showLike?: boolean
  /** Adds a "Liked by …" line under each song, as chat does. */
  showLikers?: boolean
}) {
  if (tracks.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul>
      {tracks.map((track, index) => (
        <TrackRow
          key={`${track.id}-${index}`}
          track={track}
          detail={showLikers ? <LikedByLine track={track} /> : undefined}
          actions={
            <TrackActions
              track={track}
              controller={controller}
              showLike={showLike}
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
  detail,
  actions,
}: {
  track: MusicTrack | QueuedTrack
  meta?: string
  leading?: ReactNode
  /** Optional third line under the artist. */
  detail?: ReactNode
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
        {detail}
      </div>
      <div className="-mr-1 flex shrink-0 items-center">{actions}</div>
    </li>
  )
}

function TrackActions({
  track,
  controller,
  showLike,
}: {
  track: MusicTrack
  controller: RoomMusicController
  showLike: boolean
}) {
  const [queued, setQueued] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

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

  async function queue(playNext: boolean) {
    setMenuOpen(false)
    if (await controller.enqueue(track.id, playNext)) setQueued(true)
  }

  return (
    <div ref={menuRef} className="relative flex items-center">
      {showLike && <TrackLikeButton track={track} />}
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={
          queued ? "Added to the queue" : `Queue options for ${track.title}`
        }
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={queued ? "Added" : "Play next or add to queue"}
        className={
          ICON_BUTTON +
          (menuOpen || queued ? " bg-white/[0.08] text-white" : "")
        }
      >
        {queued ? (
          <Check className="size-4" strokeWidth={2.4} />
        ) : (
          <ListPlus className="size-4" strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        onClick={() => void controller.playNow(track.id)}
        aria-label={`Play ${track.title} now`}
        title="Play now"
        className={ICON_BUTTON}
      >
        <Play className="size-4" strokeWidth={2.2} fill="currentColor" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 mt-1 w-48 origin-top-right rounded-2xl border border-white/10 bg-[#161512] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)] motion-safe:animate-[music-pop_160ms_cubic-bezier(0.23,1,0.32,1)]"
        >
          <style>{`@keyframes music-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
          <MenuItem
            icon={<ListStart className="size-4" strokeWidth={2} />}
            onClick={() => void queue(true)}
          >
            Play next
          </MenuItem>
          <MenuItem
            icon={<ListEnd className="size-4" strokeWidth={2} />}
            onClick={() => void queue(false)}
          >
            Add to queue
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function LikedByLine({ track }: { track: MusicTrack }) {
  const { label } = useSongLike(track)
  if (!label) return null
  return (
    <p className="mt-0.5 truncate text-[11px] leading-4 text-rose-200/60">
      {label}
    </p>
  )
}

/** Hooks can't be called conditionally, so the heart owns its like state. */
function TrackLikeButton({ track }: { track: MusicTrack }) {
  const like = useSongLike(track)
  return <LikeButton like={like} title={track.title} small />
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] text-white/82 transition-colors duration-150 [@media(hover:hover)]:hover:bg-white/[0.07]"
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
