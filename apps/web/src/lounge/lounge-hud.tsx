import { useEffect, useRef, useState } from "react"
import {
  Armchair,
  ArrowBigUp,
  CircleHelp,
  LayoutGrid,
  Music2,
  PartyPopper,
  Send,
  X,
} from "lucide-react"

import { controls, installLoungeKeys } from "./controls"
import { lounge } from "./lounge-store"
import { FullscreenButton } from "./fullscreen-button"
import type { RoomSnapshot, SendChatMessageInput } from "@workspace/game"
import type { BeatGrid } from "./beat"
import type { BeatState } from "./beat-engine"
import { MusicButton } from "@/components/music-player"
import {
  TOOLBAR_BUTTON,
  ToolbarDivider,
  ToolbarGroup,
} from "@/components/toolbar"
import { useMusicController, useMusicPanel } from "@/lib/room-music"

const HELP_SEEN_KEY = "uno:lounge-help-seen"

type Props = {
  room: RoomSnapshot
  selfId: string
  grid: BeatGrid
  beat: BeatState
  tap: () => void
  tapCount: number
  status: { current: { nearSeat: boolean; dancing: boolean } }
  seated: boolean
  ready: boolean
  onSendChatMessage: (input: SendChatMessageInput) => void | Promise<boolean>
}

const PANEL =
  "rounded-2xl border border-white/[0.08] bg-[#0b0a0d]/75 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md"

export function LoungeHud({
  room,
  selfId,
  grid,
  beat,
  tap,
  tapCount,
  status,
  seated,
  ready,
  onSendChatMessage,
}: Props) {
  const [helpOpen, setHelpOpen] = useState(() => {
    try {
      return localStorage.getItem(HELP_SEEN_KEY) !== "1"
    } catch {
      return true
    }
  })
  const [hint, setHint] = useState<string | null>(null)
  const [nearSeat, setNearSeat] = useState(false)
  const chatInput = useRef<HTMLInputElement>(null)
  const coarse = useCoarsePointer()
  const isMyTurn =
    room.status === "playing" && room.game?.turnPlayerId === selfId
  const selfState = room.game?.players.find((p) => p.playerId === selfId)
  // Out of this match (or joined mid-match): sitting down means watching.
  const outThisMatch =
    room.status === "playing" &&
    (!selfState ||
      selfState.eliminated ||
      selfState.voteKicked ||
      selfState.waiting ||
      Boolean(selfState.winnerPlacement))

  function closeHelp() {
    setHelpOpen(false)
    try {
      localStorage.setItem(HELP_SEEN_KEY, "1")
    } catch {
      // Fine: the card just shows again next time.
    }
  }

  useEffect(() => {
    controls.enabled = !seated
    return () => {
      controls.enabled = true
    }
  }, [seated])

  useEffect(
    () =>
      installLoungeKeys((key, event) => {
        if (key === "e") {
          if (seated) lounge.stand()
          else if (status.current.nearSeat) controls.interact = true
          else setHint("Walk up to your chair at the table, or press Sit.")
          return
        }
        // Everything else belongs to the table while seated.
        if (seated) return
        if (key === "t") tap()
        if (key === "enter") {
          event.preventDefault()
          chatInput.current?.focus()
        }
        if (key === "h" || key === "?") setHelpOpen((open) => !open)
      }),
    [seated, tap]
  )

  // Mirror the scene's proximity flag into React a few times a second.
  useEffect(() => {
    const timer = window.setInterval(
      () => setNearSeat(status.current.nearSeat),
      200
    )
    return () => window.clearInterval(timer)
  }, [status])

  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(null), 2_600)
    return () => window.clearTimeout(timer)
  }, [hint])

  if (seated) {
    // The classic table is showing; keep out of its way.
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-0 text-white antialiased">
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-[#050407]">
          <p className="text-sm text-white/60 motion-safe:animate-pulse">
            Opening the lounge…
          </p>
        </div>
      )}

      {/* Leaves room for the toolbar on the right at phone widths. */}
      <div className="absolute top-3 left-3 flex max-w-[min(360px,calc(100vw-10.5rem))] flex-col gap-2 sm:top-4 sm:left-4">
        <NowPlaying
          grid={grid}
          beat={beat}
          tap={tap}
          tapCount={tapCount}
          coarse={coarse}
        />
      </div>

      <div className="pointer-events-auto absolute top-3 right-3 sm:top-4 sm:right-4">
        <ToolbarGroup
          label="Lounge controls"
          className="bg-[#0b0a0d]/75 backdrop-blur-md"
        >
          <MusicButton />
          <FullscreenButton />
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            onClick={() => setHelpOpen((open) => !open)}
            aria-label="Lounge controls help"
            title="Controls (H)"
          >
            <CircleHelp className="size-4" strokeWidth={2} />
          </button>
          <ToolbarDivider />
          <button
            type="button"
            className={TOOLBAR_BUTTON}
            onClick={() => lounge.close()}
            aria-label="Back to the classic view"
            title="Classic view"
          >
            <LayoutGrid className="size-4" strokeWidth={2} />
          </button>
        </ToolbarGroup>
      </div>

      {helpOpen && <HelpCard coarse={coarse} onClose={closeHelp} />}

      <div
        className={
          "absolute inset-x-0 flex flex-col items-center gap-2 px-3 " +
          // Without touch controls the chat bar takes the bottom on phones.
          (coarse
            ? "bottom-[max(1rem,env(safe-area-inset-bottom))]"
            : "bottom-[4.5rem] sm:bottom-4")
        }
      >
        {hint && (
          <p className={PANEL + " px-3 py-1.5 text-xs text-white/75"}>{hint}</p>
        )}
        <button
          type="button"
          onClick={() => lounge.sit()}
          className={
            "pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96] " +
            (isMyTurn
              ? "bg-white text-black shadow-[0_0_40px_rgba(255,255,255,0.35)] motion-safe:animate-pulse"
              : nearSeat
                ? "bg-white/90 text-black"
                : "border border-white/10 bg-[#0b0a0d]/75 text-white/85 backdrop-blur-md")
          }
        >
          <Armchair className="size-4" strokeWidth={2} />
          {isMyTurn
            ? "Your turn — sit and play"
            : room.status === "lobby"
              ? "Sit at the table"
              : outThisMatch
                ? "Sit and watch"
                : "Sit and play"}
          {!coarse && (nearSeat || isMyTurn) && (
            <kbd className="rounded bg-black/10 px-1.5 py-0.5 text-[11px] font-medium">
              E
            </kbd>
          )}
        </button>
      </div>

      <ChatLine
        room={room}
        inputRef={chatInput}
        coarse={coarse}
        onSend={(body) =>
          onSendChatMessage({ channel: "public", kind: "text", body })
        }
      />

      {coarse && <TouchControls />}
    </div>
  )
}

function NowPlaying({
  grid,
  beat,
  tap,
  tapCount,
  coarse,
}: {
  grid: BeatGrid
  beat: BeatState
  tap: () => void
  tapCount: number
  coarse: boolean
}) {
  const music = useMusicController()
  const panel = useMusicPanel()
  const track = music?.snapshot?.nowPlaying ?? null
  const playing = music?.snapshot?.status === "playing"
  const dot = useRef<HTMLSpanElement>(null)

  // The dot pulses with the same beat as the lights.
  useEffect(() => {
    let frame = 0
    const loop = () => {
      if (dot.current) {
        const scale = 1 + beat.kick * 0.9 * (playing ? 1 : 0)
        dot.current.style.transform = `scale(${scale})`
        dot.current.style.opacity = String(
          playing ? 0.45 + beat.kick * 0.55 : 0.3
        )
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [beat, playing])

  if (!track) {
    return (
      <button
        type="button"
        onClick={() => panel.setOpen(true)}
        className={
          PANEL +
          " pointer-events-auto flex items-center gap-3 px-3 py-2.5 text-left"
        }
      >
        <span className="grid size-9 place-items-center rounded-xl bg-white/[0.06]">
          <Music2 className="size-4 text-white/70" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">
            The DJ is waiting
          </span>
          <span className="block text-xs text-white/55">
            Queue a song to light up the room
          </span>
        </span>
      </button>
    )
  }

  const source =
    grid.source === "tap"
      ? `synced by ${grid.setByName ?? "a tap"}`
      : grid.source === "lookup"
        ? "tempo matched"
        : "tempo guessed"

  return (
    <div
      className={
        PANEL + " pointer-events-auto flex items-center gap-3 p-2 pr-2.5"
      }
    >
      <img
        src={track.thumbnailUrl}
        alt=""
        className="size-11 shrink-0 rounded-xl object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{track.title}</p>
        <p className="flex items-center gap-1.5 truncate text-[11px] text-white/55">
          <span
            ref={dot}
            className="inline-block size-1.5 shrink-0 rounded-full bg-white will-change-transform"
          />
          <span className="tabular-nums">{Math.round(grid.bpm)} BPM</span>
          <span aria-hidden>·</span>
          <span className="capitalize">{grid.mood}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{source}</span>
        </p>
      </div>
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault()
          tap()
        }}
        disabled={!playing}
        title="Tap along to the beat to sync everyone's lights (T)"
        className="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white/85 tabular-nums transition-transform duration-100 ease-out active:scale-[0.92] disabled:opacity-40"
      >
        {tapCount > 0 ? (
          `Tap ${Math.min(tapCount, 6)}/6`
        ) : (
          <>
            Tap<span className="hidden sm:inline"> beat</span>
            {!coarse && <span className="hidden sm:inline"> · T</span>}
          </>
        )}
      </button>
    </div>
  )
}

function ChatLine({
  room,
  inputRef,
  coarse,
  onSend,
}: {
  room: RoomSnapshot
  inputRef: React.RefObject<HTMLInputElement | null>
  coarse: boolean
  onSend: (body: string) => void | Promise<boolean>
}) {
  const [draft, setDraft] = useState("")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const recent = room.chatMessages
    .filter((message) => message.channel === "public")
    .slice(-4)
    .filter((message) => now - Date.parse(message.createdAt) < 15_000)

  return (
    <div
      className={
        "absolute flex w-[min(340px,calc(100vw-1.5rem))] flex-col gap-1.5 " +
        (coarse ? "top-20 left-3" : "bottom-4 left-4")
      }
    >
      {recent.map((message) => (
        <p
          key={message.id}
          className="w-fit max-w-full truncate rounded-xl bg-black/45 px-2.5 py-1 text-xs text-white/85 backdrop-blur-sm"
        >
          <span className="font-semibold text-white">{message.playerName}</span>{" "}
          {message.kind === "gif" ? "sent a GIF" : message.body}
        </p>
      ))}
      <form
        className={
          PANEL + " pointer-events-auto flex items-center gap-1 p-1 pl-3"
        }
        onSubmit={(event) => {
          event.preventDefault()
          const body = draft.trim()
          if (!body) return
          void onSend(body)
          setDraft("")
          inputRef.current?.blur()
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur()
          }}
          maxLength={280}
          placeholder={coarse ? "Say something…" : "Press Enter to chat"}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-white outline-none placeholder:text-white/40"
          // Phones zoom into inputs under 16px.
          style={coarse ? { fontSize: 16 } : undefined}
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid size-8 place-items-center rounded-full text-white/70 active:scale-[0.92] [@media(hover:hover)]:hover:bg-white/[0.08]"
        >
          <Send className="size-3.5" strokeWidth={2} />
        </button>
      </form>
    </div>
  )
}

function HelpCard({
  coarse,
  onClose,
}: {
  coarse: boolean
  onClose: () => void
}) {
  const rows: Array<[string, string]> = coarse
    ? [
        ["Left stick", "Walk (push far to run)"],
        ["Drag", "Look around"],
        ["Jump · Dance", "Buttons on the right"],
        ["Sit", "Play the game at the table"],
        ["Tap beat", "Tap along to sync the lights"],
      ]
    : [
        ["W A S D", "Walk"],
        ["Shift", "Run"],
        ["Space", "Jump"],
        ["Drag · Scroll", "Look · Zoom"],
        ["1 – 4", "Dance moves"],
        ["E", "Sit at your chair / stand up"],
        ["Enter", "Chat"],
        ["T", "Tap the beat to sync the lights"],
      ]
  return (
    <div className="pointer-events-auto absolute top-1/2 left-1/2 w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2">
      <div className={PANEL + " p-4"}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Welcome to the lounge</h2>
            <p className="mt-0.5 text-xs text-white/55">
              Same game, same cards. Take a seat to play.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 grid size-8 place-items-center rounded-full text-white/60 [@media(hover:hover)]:hover:bg-white/[0.08]"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {rows.map(([key, action]) => (
            <div key={key} className="contents">
              <dt className="font-semibold whitespace-nowrap text-white/90">
                {key}
              </dt>
              <dd className="text-white/60">{action}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-full bg-white py-2 text-sm font-semibold text-black active:scale-[0.98]"
        >
          Let's go
        </button>
      </div>
    </div>
  )
}

/** Thumb joystick on the left, jump and dance on the right. */
function TouchControls() {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const active = useRef<number | null>(null)
  const [dance, setDance] = useState(0)

  function move(event: React.PointerEvent) {
    const rect = base.current?.getBoundingClientRect()
    if (!rect) return
    const radius = rect.width / 2
    let x = (event.clientX - (rect.left + radius)) / radius
    let y = (event.clientY - (rect.top + radius)) / radius
    const length = Math.hypot(x, y)
    if (length > 1) {
      x /= length
      y /= length
    }
    controls.stick.x = x
    controls.stick.y = -y
    if (knob.current)
      knob.current.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`
  }
  function release() {
    active.current = null
    controls.stick.x = 0
    controls.stick.y = 0
    if (knob.current) knob.current.style.transform = ""
  }

  return (
    <>
      <div
        ref={base}
        className="pointer-events-auto absolute bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.5rem))] left-6 size-32 touch-none rounded-full border border-white/15 bg-white/[0.06] backdrop-blur-sm"
        onPointerDown={(event) => {
          active.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event)
        }}
        onPointerMove={(event) => {
          if (active.current === event.pointerId) move(event)
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div
          ref={knob}
          className="absolute top-1/2 left-1/2 -mt-7 -ml-7 size-14 rounded-full bg-white/80 shadow-[0_6px_20px_rgba(0,0,0,0.4)]"
        />
      </div>
      <div className="pointer-events-auto absolute right-5 bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.5rem))] flex flex-col items-end gap-3">
        <button
          type="button"
          aria-label="Dance"
          onPointerDown={(event) => {
            event.preventDefault()
            controls.dance = dance
            setDance((current) => (current + 1) % 4)
          }}
          className="grid size-14 place-items-center rounded-full border border-white/15 bg-white/[0.08] text-white backdrop-blur-sm active:scale-[0.92]"
        >
          <PartyPopper className="size-5" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Jump"
          onPointerDown={(event) => {
            event.preventDefault()
            controls.jump = true
          }}
          className="grid size-16 place-items-center rounded-full bg-white/85 text-black shadow-[0_6px_20px_rgba(0,0,0,0.4)] active:scale-[0.92]"
        >
          <ArrowBigUp className="size-6" strokeWidth={2} />
        </button>
      </div>
    </>
  )
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)")
    setCoarse(query.matches)
    const onChange = () => setCoarse(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])
  return coarse
}
