import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Lightbulb, Mic, MicOff, X } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { UnoCard } from "@workspace/ui/components/uno-card"
import type { Card } from "@workspace/ui/components/uno-card"

const EASE = "cubic-bezier(0.2,0,0,1)"

/** How long the pointer takes to travel to a target before it "clicks". */
const MOVE_MS = 800
/** How long a beat lingers after the click so the result is readable. */
const DEFAULT_HOLD_MS = 2000

const OPPONENTS = ["Aman", "Rhea", "Kabir"] as const

/** Circular icon-button styling shared with VoiceToggleButton / CopyInviteButton. */
const triggerBase =
  "inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/74 transition-[background-color,border-color,color,scale] active:scale-[0.96] hover:border-white/18 hover:bg-white/[0.075] hover:text-white/88"

// ---------------------------------------------------------------------------
// Mock table state — the tour drives this exactly like a player would.
// ---------------------------------------------------------------------------

type Mock = {
  micOn: boolean
  hand: Array<Card>
  staged: Array<Card>
  discard: Card
  showCycle: boolean
  showSwap: boolean
  cycle: boolean
  swap: boolean
  swapOpen: boolean
  swapWith: string | null
  uno: boolean
  action: "End turn" | "Pass turn"
  toast: string | null
}

const card = (id: string, color: Card["color"], face: Card["face"]): Card => ({
  id,
  color,
  face,
})

const num = (id: string, color: Card["color"], value: number): Card =>
  card(id, color, { kind: "number", value: value as never })

const baseMock: Mock = {
  micOn: true,
  hand: [],
  staged: [],
  discard: num("d-base", "red", 5),
  showCycle: false,
  showSwap: false,
  cycle: false,
  swap: false,
  swapOpen: false,
  swapWith: null,
  uno: false,
  action: "End turn",
  toast: null,
}

/**
 * One pointer move + click. `apply` runs the moment the pointer lands, so the
 * mock always reacts *after* the cursor arrives rather than ahead of it.
 */
type Beat = {
  target: string | null
  caption: string
  hold?: number
  apply?: (mock: Mock) => Mock
}

type Chapter = {
  id: string
  title: string
  init: Mock
  beats: Array<Beat>
}

/**
 * Beat helpers. They stay no-ops when the mock isn't in the shape the beat
 * expects (a chapter jump can land a beat on a half-updated table), so a stray
 * apply can never hand `UnoCard` an undefined card.
 */
const stageFirstCard = (mock: Mock, extra: Partial<Mock> = {}): Mock => {
  const [first, ...rest] = mock.hand
  if (!first) return { ...mock, ...extra }
  return { ...mock, hand: rest, staged: [first], ...extra }
}

const unstage = (mock: Mock): Mock => {
  if (mock.staged.length === 0) return mock
  return { ...mock, hand: [...mock.staged, ...mock.hand], staged: [] }
}

const commitStaged = (mock: Mock, extra: Partial<Mock> = {}): Mock => ({
  ...mock,
  discard: mock.staged[0] ?? mock.discard,
  staged: [],
  ...extra,
})

const CHAPTERS: Array<Chapter> = [
  {
    id: "voice",
    title: "Mic",
    init: {
      ...baseMock,
      hand: [
        num("v1", "red", 3),
        num("v2", "green", 5),
        num("v3", "blue", 7),
        num("v4", "yellow", 1),
      ],
    },
    beats: [
      {
        target: "mic",
        caption: "You're in voice the moment you join. Tap the mic to mute.",
        apply: (mock) => ({ ...mock, micOn: false }),
      },
      {
        target: "mic",
        caption: "Tap it again to talk to the table.",
        apply: (mock) => ({ ...mock, micOn: true }),
      },
    ],
  },
  {
    id: "staging",
    title: "Staging area",
    init: {
      ...baseMock,
      hand: [
        num("s1", "red", 3),
        num("s2", "green", 5),
        num("s3", "blue", 7),
        num("s4", "yellow", 1),
      ],
    },
    beats: [
      {
        target: "hand-0",
        caption: "Tap a card that matches the colour or the number.",
        apply: (mock) => stageFirstCard(mock),
      },
      {
        target: "staging",
        caption:
          "It lands in the staging area — you can also drag cards straight here.",
        hold: 2800,
      },
      {
        target: "staged-0",
        caption: "Changed your mind? Tap a staged card to send it back.",
        apply: unstage,
      },
    ],
  },
  {
    id: "end-pass",
    title: "End turn & Pass turn",
    init: {
      ...baseMock,
      hand: [
        num("e2", "green", 5),
        num("e3", "blue", 7),
        num("e4", "yellow", 1),
      ],
      staged: [num("e1", "red", 3)],
    },
    beats: [
      {
        target: "action",
        caption: "End turn commits everything sitting in the staging area.",
        apply: (mock) => commitStaged(mock, { toast: "You played Red 3" }),
      },
      {
        target: "hand",
        caption: "Next turn: the pile is Blue 9 and nothing here matches.",
        apply: (mock) => ({
          ...mock,
          discard: num("e5", "blue", 9),
          hand: [num("e6", "green", 5), num("e7", "red", 1)],
          toast: null,
        }),
      },
      {
        target: "deck",
        caption: "So draw one from the deck.",
        apply: (mock) => ({
          ...mock,
          hand: [...mock.hand, num("e8", "yellow", 4)],
          action: "Pass turn",
        }),
      },
      {
        target: "action",
        caption:
          "The button now reads Pass turn — hit it to hand the turn along.",
        apply: (mock) => ({ ...mock, toast: "Turn passed to Aman" }),
      },
    ],
  },
  {
    id: "cycle",
    title: "Cycle hands (0)",
    init: {
      ...baseMock,
      discard: num("c0", "yellow", 4),
      hand: [
        num("c1", "yellow", 0),
        num("c2", "green", 5),
        num("c3", "blue", 7),
        num("c4", "red", 1),
      ],
    },
    beats: [
      {
        target: "hand-0",
        caption: "Stage a 0 — that's the card that rotates every hand.",
        apply: (mock) => stageFirstCard(mock, { showCycle: true }),
      },
      {
        target: "cycle",
        caption: "A Cycle hands toggle appears. Tick it to arm the rotation.",
        apply: (mock) => ({ ...mock, cycle: true }),
      },
      {
        target: "action",
        caption: "End turn, and every hand shifts one seat around the table.",
        hold: 2900,
        apply: (mock) => commitStaged(mock, { toast: "Hands cycled ↻" }),
      },
    ],
  },
  {
    id: "swap",
    title: "Swap hands (7)",
    init: {
      ...baseMock,
      discard: num("w0", "red", 2),
      hand: [
        num("w1", "red", 7),
        num("w2", "green", 5),
        num("w3", "blue", 9),
        num("w4", "yellow", 1),
      ],
    },
    beats: [
      {
        target: "hand-0",
        caption: "Stage a 7 — this one trades your whole hand with someone.",
        apply: (mock) => stageFirstCard(mock, { showSwap: true }),
      },
      {
        target: "swap",
        caption: "Tick Swap…",
        hold: 1800,
        apply: (mock) => ({ ...mock, swap: true, swapOpen: true }),
      },
      {
        target: "swap-1",
        caption: "…then pick the player you want to swap with.",
        apply: (mock) => ({ ...mock, swapWith: "Rhea", swapOpen: false }),
      },
      {
        target: "action",
        caption: "End turn — your hand and Rhea's change places.",
        hold: 2900,
        apply: (mock) =>
          commitStaged(mock, {
            hand: [num("w5", "blue", 3), num("w6", "blue", 8)],
            toast: "Swapped hands with Rhea",
          }),
      },
    ],
  },
  {
    id: "uno",
    title: "Calling UNO",
    init: {
      ...baseMock,
      discard: num("u0", "green", 4),
      hand: [num("u1", "green", 9), num("u2", "blue", 2)],
    },
    beats: [
      {
        target: "hand-0",
        caption: "Stage this and you're down to a single card.",
        apply: (mock) => stageFirstCard(mock),
      },
      {
        target: "uno",
        caption: "So tick UNO — before you end the turn, not after.",
        apply: (mock) => ({ ...mock, uno: true }),
      },
      {
        target: "action",
        caption: "End turn with UNO called and you're safe.",
        hold: 2900,
        apply: (mock) => commitStaged(mock, { toast: "UNO!" }),
      },
      {
        target: "uno",
        caption: "Forget it and anyone at the table can catch you for +2.",
        hold: 3000,
        apply: (mock) => ({ ...mock, uno: false, toast: null }),
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Self-contained "How to play" entry point: renders its own trigger icon and,
 * when opened, portals an auto-playing product tour over a miniature of the
 * real table. Takes no game state, so it drops into any header with zero prop
 * plumbing.
 */
export function HowToPlayGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [chapter, setChapter] = useState(0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="How to play"
        aria-label="How to play"
        className={cn(triggerBase, compact ? "size-8" : "size-9")}
      >
        <Lightbulb
          className={compact ? "size-3.5" : "size-4"}
          strokeWidth={2}
        />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <HowToPlayDialog
              chapter={chapter}
              onChapter={setChapter}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </>
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(query.matches)
    const handleChange = () => setReduced(query.matches)
    query.addEventListener("change", handleChange)
    return () => query.removeEventListener("change", handleChange)
  }, [])
  return reduced
}

type Spot = { left: number; top: number; width: number; height: number }

function HowToPlayDialog({
  chapter,
  onChapter,
  onClose,
}: {
  chapter: number
  onChapter: (next: number) => void
  onClose: () => void
}) {
  const titleId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const targets = useRef(new Map<string, HTMLElement>())
  const reducedMotion = useReducedMotion()

  const active = CHAPTERS[chapter]!
  const [beat, setBeat] = useState(0)
  const [landed, setLanded] = useState(false)
  const [mock, setMock] = useState<Mock>(active.init)
  const [spot, setSpot] = useState<Spot | null>(null)

  const currentBeat = active.beats[Math.min(beat, active.beats.length - 1)]!

  const goChapter = useCallback(
    (next: number) => {
      const wrapped = (next + CHAPTERS.length) % CHAPTERS.length
      onChapter(wrapped)
      setBeat(0)
      setLanded(false)
      setMock(CHAPTERS[wrapped]!.init)
    },
    [onChapter]
  )

  // Restart the chapter whenever it changes from the outside (dots, arrows).
  useEffect(() => {
    setBeat(0)
    setLanded(false)
    setMock(CHAPTERS[chapter]!.init)
  }, [chapter])

  // Beat runner: travel → click (apply) → hold → next.
  useEffect(() => {
    const step = active.beats[beat]
    if (!step) return
    setLanded(false)
    const moveMs = reducedMotion ? 120 : MOVE_MS
    const land = window.setTimeout(() => {
      setLanded(true)
      if (step.apply) setMock((current) => step.apply!(current))
    }, moveMs)
    const advance = window.setTimeout(
      () => {
        if (beat + 1 < active.beats.length) setBeat(beat + 1)
        else goChapter(chapter + 1)
      },
      moveMs + (step.hold ?? DEFAULT_HOLD_MS)
    )
    return () => {
      window.clearTimeout(land)
      window.clearTimeout(advance)
    }
  }, [active, beat, chapter, goChapter, reducedMotion])

  const registerTarget = useCallback((key: string, el: HTMLElement | null) => {
    if (el) targets.current.set(key, el)
    else targets.current.delete(key)
  }, [])

  // Measure the highlighted element after the DOM settles for this beat.
  useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      const key = currentBeat.target
      const el = key ? targets.current.get(key) : undefined
      if (!key) {
        setSpot(null)
        return
      }
      // Target not in the DOM yet (mid chapter switch): hold the last spot so
      // the pointer glides to the new one instead of blinking out.
      if (!stage || !el) return
      const stageBox = stage.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      setSpot({
        left: box.left - stageBox.left,
        top: box.top - stageBox.top,
        width: box.width,
        height: box.height,
      })
    }
    // Measure synchronously (the DOM for this beat is already committed), then
    // once more after paint to pick up any late layout — rAF alone would stall
    // whenever the tab is backgrounded.
    measure()
    const frame = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
    }
  }, [currentBeat, mock, chapter, beat])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowRight") goChapter(chapter + 1)
      if (event.key === "ArrowLeft") goChapter(chapter - 1)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [chapter, goChapter, onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    sectionRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed inset-0 z-[96] flex items-end justify-center bg-black/72 px-0 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={sectionRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-t border-white/12 bg-[#11100d] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-white shadow-[0_-24px_90px_rgba(0,0,0,0.7)] outline-none sm:max-w-md sm:rounded-3xl sm:border sm:border-t-white/12 sm:pb-5 sm:shadow-[0_28px_90px_rgba(0,0,0,0.66)]"
      >
        <span
          aria-hidden="true"
          className="mx-auto mb-4 block h-1 w-10 rounded-full bg-white/20 sm:hidden"
        />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-amber-100/70 uppercase">
              How to play
            </p>
            <h2
              id={titleId}
              className="mt-1 text-xl font-semibold tracking-tight"
            >
              {active.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close how to play"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/66 hover:bg-white/[0.09]"
          >
            <X className="size-4" strokeWidth={1.9} />
          </button>
        </div>

        <div aria-live="polite" className="sr-only">
          {`${active.title}: ${currentBeat.caption}`}
        </div>

        <div
          ref={stageRef}
          // Purely decorative replay of the table: the caption's live region
          // carries the actual narration, so keep it out of the tab order.
          className="relative mt-4 overflow-hidden rounded-2xl border border-white/8 bg-black/25 p-2.5"
        >
          <MiniTable mock={mock} registerTarget={registerTarget} />
          <Spotlight spot={spot} reducedMotion={reducedMotion} />
          <TourCursor
            spot={spot}
            landed={landed}
            reducedMotion={reducedMotion}
          />
        </div>

        <p className="mt-4 min-h-[3rem] text-center text-sm leading-6 text-white/72">
          {currentBeat.caption}
        </p>

        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => goChapter(chapter - 1)}
            aria-label="Previous section"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/40 text-white/70 hover:bg-black/55"
          >
            ‹
          </button>
          <div className="flex items-center gap-1.5">
            {CHAPTERS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goChapter(index)}
                aria-label={`${item.title} (${index + 1} of ${CHAPTERS.length})`}
                aria-current={index === chapter ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color]",
                  index === chapter
                    ? "w-5 bg-white/80"
                    : "w-1.5 bg-white/25 hover:bg-white/40"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => goChapter(chapter + 1)}
            aria-label="Next section"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-black/40 text-white/70 hover:bg-black/55"
          >
            ›
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tour chrome
// ---------------------------------------------------------------------------

function Spotlight({
  spot,
  reducedMotion,
}: {
  spot: Spot | null
  reducedMotion: boolean
}) {
  if (!spot) return null
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-20 rounded-[10px] ring-2 ring-amber-200/85"
      style={{
        left: spot.left - 4,
        top: spot.top - 4,
        width: spot.width + 8,
        height: spot.height + 8,
        boxShadow:
          "0 0 0 9999px rgba(0,0,0,0.3), 0 0 22px rgba(253,224,71,0.35)",
        transition: reducedMotion
          ? undefined
          : `left 550ms ${EASE}, top 550ms ${EASE}, width 550ms ${EASE}, height 550ms ${EASE}`,
      }}
    />
  )
}

function TourCursor({
  spot,
  landed,
  reducedMotion,
}: {
  spot: Spot | null
  landed: boolean
  reducedMotion: boolean
}) {
  if (!spot) return null
  const x = spot.left + spot.width / 2
  const y = spot.top + spot.height / 2
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-30"
      style={{
        left: x,
        top: y,
        transition: reducedMotion
          ? undefined
          : `left ${MOVE_MS}ms ${EASE}, top ${MOVE_MS}ms ${EASE}`,
      }}
    >
      {landed && !reducedMotion && (
        <span
          className="absolute -top-3 -left-3 block size-6 rounded-full bg-amber-200/70"
          style={{ animation: `htp-ripple 620ms ${EASE} forwards` }}
        />
      )}
      <svg
        viewBox="0 0 24 24"
        className="relative block size-6 drop-shadow-[0_2px_6px_rgba(0,0,0,0.75)]"
        style={{
          transform: landed ? "scale(0.86)" : "scale(1)",
          transition: reducedMotion ? undefined : `transform 160ms ${EASE}`,
        }}
      >
        <path
          d="M5 3l13 8-5.4 1.4L10.4 18 5 3z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
      <style>{`
        @keyframes htp-ripple {
          0% { transform: scale(0.4); opacity: .75; }
          100% { transform: scale(2.1); opacity: 0; }
        }
      `}</style>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Miniature table
// ---------------------------------------------------------------------------

type RegisterTarget = (key: string, el: HTMLElement | null) => void

function MiniCard({
  card: value,
  scale = 0.5,
  faceDown = false,
  className,
}: {
  card: Card | undefined
  scale?: number
  faceDown?: boolean
  className?: string
}) {
  if (!value) return null
  return (
    <span
      className={cn("relative block shrink-0", className)}
      style={{ width: 72 * scale, height: 102 * scale }}
    >
      <span
        className="block origin-top-left"
        style={{ transform: `scale(${scale})` }}
      >
        <UnoCard card={value} size="sm" faceDown={faceDown} static />
      </span>
    </span>
  )
}

function MiniTable({
  mock,
  registerTarget,
}: {
  mock: Mock
  registerTarget: RegisterTarget
}) {
  const backCard = card("htp-back", "wild", { kind: "wild" })

  return (
    <div className="flex flex-col gap-2">
      {/* Header row: room chip + mic */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2 py-1.5">
        <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/55">
          ROOM · 4X7K
        </span>
        <span className="flex items-center gap-1.5">
          <span
            ref={(el) => registerTarget("mic", el)}
            className={cn(
              "grid size-7 place-items-center rounded-full border transition-colors",
              mock.micOn
                ? "border-white/12 bg-white/[0.06] text-white/80"
                : "border-red-300/35 bg-red-500/12 text-red-200"
            )}
          >
            {mock.micOn ? (
              <Mic className="size-3.5" strokeWidth={2} />
            ) : (
              <MicOff className="size-3.5" strokeWidth={2} />
            )}
          </span>
        </span>
      </div>

      {/* Opponents */}
      <div className="flex items-center justify-center gap-2">
        {OPPONENTS.map((name, index) => (
          <span
            key={name}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors",
              mock.swapWith === name
                ? "border-amber-200/60 bg-amber-300/15 text-amber-50"
                : "border-white/10 bg-white/[0.04] text-white/60"
            )}
          >
            <span className="grid size-4 place-items-center rounded-full bg-white/12 text-[9px] text-white/75">
              {name[0]}
            </span>
            {name}
            <span className="text-white/38">{5 + index}</span>
          </span>
        ))}
      </div>

      {/* Table: deck, discard, staging */}
      <div className="relative flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-2 py-2.5">
        {mock.toast && (
          <span className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-full border border-amber-200/25 bg-[#241a0c] px-2.5 py-0.5 text-[10px] font-medium text-amber-50/90">
            {mock.toast}
          </span>
        )}
        <div className="flex items-center gap-6">
          <span
            ref={(el) => registerTarget("deck", el)}
            className="relative block"
          >
            <MiniCard card={backCard} faceDown scale={0.52} />
            <span className="absolute -right-1 -bottom-1 rounded-full bg-white/90 px-1.5 text-[9px] font-bold text-neutral-950">
              48
            </span>
          </span>
          <MiniCard card={mock.discard} scale={0.52} className="rotate-3" />
        </div>

        <div
          ref={(el) => registerTarget("staging", el)}
          className="w-full rounded-lg border border-white/8 bg-black/30 px-2 py-1.5"
        >
          <p className="text-[10px] font-medium text-white/55">
            {mock.staged.length > 0
              ? `You staged ${mock.staged.length} card${mock.staged.length === 1 ? "" : "s"} · tap to remove`
              : "Drop cards here"}
          </p>
          <div className="mt-1 flex h-[42px] items-center justify-center gap-1.5">
            {mock.staged.length > 0 ? (
              mock.staged.map((staged, index) => (
                <span
                  key={staged.id}
                  ref={(el) => registerTarget(`staged-${index}`, el)}
                >
                  <MiniCard card={staged} scale={0.4} />
                </span>
              ))
            ) : (
              <span className="text-[10px] text-white/28">
                tap or drag a card up here
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="relative flex flex-wrap items-center justify-end gap-1.5">
        {mock.swapOpen && (
          <div className="absolute right-0 bottom-[calc(100%+6px)] z-10 w-32 overflow-hidden rounded-lg border border-white/12 bg-neutral-950 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
            {OPPONENTS.map((name, index) => (
              <span
                key={name}
                ref={(el) => registerTarget(`swap-${index}`, el)}
                className="block px-2.5 py-1.5 text-[11px] text-white/72"
              >
                {name}
              </span>
            ))}
          </div>
        )}
        {mock.showCycle && (
          <MiniCheckbox
            label="Cycle hands"
            checked={mock.cycle}
            registerTarget={registerTarget}
            targetKey="cycle"
          />
        )}
        {mock.showSwap && (
          <MiniCheckbox
            label={mock.swapWith ? `Swap · ${mock.swapWith}` : "Swap"}
            checked={mock.swap}
            registerTarget={registerTarget}
            targetKey="swap"
          />
        )}
        <MiniCheckbox
          label="UNO"
          checked={mock.uno}
          registerTarget={registerTarget}
          targetKey="uno"
        />
        <span
          ref={(el) => registerTarget("action", el)}
          className="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-950"
        >
          {mock.action}
        </span>
      </div>

      {/* Hand */}
      <div
        ref={(el) => registerTarget("hand", el)}
        className="flex min-h-[62px] items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-black/30 px-2 py-2"
      >
        {mock.hand.map((handCard, index) => (
          <span
            key={handCard.id}
            ref={(el) => registerTarget(`hand-${index}`, el)}
          >
            <MiniCard card={handCard} scale={0.46} />
          </span>
        ))}
      </div>
    </div>
  )
}

function MiniCheckbox({
  label,
  checked,
  targetKey,
  registerTarget,
}: {
  label: string
  checked: boolean
  targetKey: string
  registerTarget: RegisterTarget
}) {
  return (
    <span
      ref={(el) => registerTarget(targetKey, el)}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap transition-colors",
        checked
          ? "border-amber-200/45 bg-amber-300/12 text-amber-50"
          : "border-white/10 bg-white/[0.055] text-white/65"
      )}
    >
      <span
        className={cn(
          "grid size-3 place-items-center rounded-[3px] border",
          checked
            ? "border-amber-200 bg-amber-200 text-neutral-950"
            : "border-white/30"
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5">
            <path
              d="M2.5 6.4l2.2 2.2 4.8-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {label}
    </span>
  )
}
