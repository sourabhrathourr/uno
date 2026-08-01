import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"

import { UnoCard } from "@workspace/ui/components/uno-card"
import type {
  Card,
  CardColor,
  CardFace,
  CardSize,
} from "@workspace/ui/components/uno-card"

export const Route = createFileRoute("/cards")({ component: CardsLab })

const colors: Array<Exclude<CardColor, "wild">> = [
  "red",
  "yellow",
  "green",
  "blue",
]
const numberValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

function id(parts: Array<string>) {
  return parts.join(":")
}

function makeNumberRow(): Array<Card> {
  const out: Array<Card> = []
  for (const c of colors) {
    for (const v of numberValues) {
      out.push({
        id: id([c, "n", String(v)]),
        color: c,
        face: { kind: "number", value: v },
      })
    }
  }
  return out
}

function makeActionRow(): Array<Card> {
  const out: Array<Card> = []
  for (const c of colors) {
    const faces: Array<CardFace> = [
      { kind: "skip" },
      { kind: "reverse" },
      { kind: "draw", count: 2 },
      { kind: "draw", count: 4 },
    ]
    faces.forEach((face, i) => {
      out.push({ id: id([c, "a", String(i)]), color: c, face })
    })
  }
  return out
}

function makeSpecialsRow(): Array<Card> {
  return [
    { id: "green:discard", color: "green", face: { kind: "discard-color" } },
    { id: "red:discard", color: "red", face: { kind: "discard-color" } },
    { id: "blue:discard", color: "blue", face: { kind: "discard-color" } },
    { id: "yellow:discard", color: "yellow", face: { kind: "discard-color" } },
  ]
}

function makeWildRow(): Array<Card> {
  return [
    { id: "wild", color: "wild", face: { kind: "wild" } },
    { id: "wild:d4", color: "wild", face: { kind: "wild-draw", count: 4 } },
    { id: "wild:d6", color: "wild", face: { kind: "wild-draw", count: 6 } },
    { id: "wild:d10", color: "wild", face: { kind: "wild-draw", count: 10 } },
    {
      id: "wild:rd4",
      color: "wild",
      face: { kind: "wild-reverse-draw", count: 4 },
    },
  ]
}

function CardsLab() {
  const [size, setSize] = useState<CardSize>("md")
  const [faceDown, setFaceDown] = useState(false)
  const numbers = makeNumberRow()
  const actions = makeActionRow()
  const specials = makeSpecialsRow()
  const wilds = makeWildRow()

  return (
    <div
      className="min-h-svh w-full antialiased"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.22 0.02 270) 0%, oklch(0.10 0.005 270) 60%, oklch(0.05 0.005 270) 100%)",
        color: "white",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-12 px-8 py-14">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-medium tracking-[0.2em] text-white/55 uppercase">
              UNO No Mercy · Components
            </p>
            <h1
              className="mt-3 text-4xl font-semibold tracking-tight text-white"
              style={{ textWrap: "balance" }}
            >
              Card lab
            </h1>
            <p
              className="mt-2 max-w-md text-sm text-white/60"
              style={{ textWrap: "pretty" }}
            >
              The foundational card. Hover to lift, click to press, focus for
              the ring. Every face is composed from the same metallic surface +
              swappable glyph.
            </p>
          </div>
          <Toolbar
            size={size}
            onSize={setSize}
            faceDown={faceDown}
            onFaceDown={setFaceDown}
          />
        </header>

        <Section
          label="Numbers"
          hint="0–9 across all four colors. The chunky underline distinguishes 6 / 9 when held inverted."
        >
          <Grid>
            {numbers.map((c) => (
              <UnoCard key={c.id} card={c} size={size} faceDown={faceDown} />
            ))}
          </Grid>
        </Section>

        <Section
          label="Action cards"
          hint="Skip, Reverse, Draw 2, Draw 4. Same color, different verbs."
        >
          <Grid>
            {actions.map((c) => (
              <UnoCard key={c.id} card={c} size={size} faceDown={faceDown} />
            ))}
          </Grid>
        </Section>

        <Section
          label="Specials"
          hint="Discard Color (dump every card of one color) in all four colors. Swap-7 and Rotate-0 are encoded as corner pips on regular number cards."
        >
          <Grid>
            {specials.map((c) => (
              <UnoCard key={c.id} card={c} size={size} faceDown={faceDown} />
            ))}
          </Grid>
        </Section>

        <Section
          label="Wilds"
          hint="The black metals. Wild Draw 4 / 6 / 10 are the No Mercy escalation ladder."
        >
          <Grid>
            {wilds.map((c) => (
              <UnoCard key={c.id} card={c} size={size} faceDown={faceDown} />
            ))}
          </Grid>
        </Section>

        <Section
          label="Hand preview"
          hint="A fanned hand at lg size, animated lift on hover."
        >
          <Hand />
        </Section>
      </div>
    </div>
  )
}

function Toolbar({
  size,
  onSize,
  faceDown,
  onFaceDown,
}: {
  size: CardSize
  onSize: (s: CardSize) => void
  faceDown: boolean
  onFaceDown: (b: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-sm backdrop-blur">
      <SegGroup label="Size" value={size} onChange={onSize}>
        {(["sm", "md", "lg", "xl"] as const).map((s) => (
          <SegBtn key={s} value={s} current={size} onClick={onSize}>
            {s}
          </SegBtn>
        ))}
      </SegGroup>
      <Divider />
      <button
        type="button"
        onClick={() => onFaceDown(!faceDown)}
        className="rounded-full px-3 py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white"
        aria-pressed={faceDown}
        style={{ transitionProperty: "background-color, color" }}
      >
        {faceDown ? "Showing back" : "Showing face"}
      </button>
    </div>
  )
}

function SegGroup<T extends string>({
  label,
  children,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="px-2 text-xs tracking-wider text-white/40 uppercase">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function SegBtn<T extends string>({
  value,
  current,
  onClick,
  children,
}: {
  value: T
  current: T
  onClick: (v: T) => void
  children: React.ReactNode
}) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      aria-pressed={active}
      className={
        "rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase transition-colors " +
        (active
          ? "bg-white/15 text-white"
          : "text-white/55 hover:bg-white/8 hover:text-white/90")
      }
      style={{ transitionProperty: "background-color, color" }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span aria-hidden className="h-5 w-px bg-white/10" />
}

function Section({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-6">
        <h2 className="text-base font-medium tracking-tight text-white">
          {label}
        </h2>
        <p
          className="max-w-lg text-right text-xs text-white/45"
          style={{ textWrap: "pretty" }}
        >
          {hint}
        </p>
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-6">
        {children}
      </div>
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>
}

function Hand() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cards: Array<Card> = [
    { id: "h1", color: "red", face: { kind: "number", value: 7 } },
    { id: "h2", color: "blue", face: { kind: "draw", count: 2 } },
    { id: "h3", color: "green", face: { kind: "skip" } },
    { id: "h4", color: "yellow", face: { kind: "reverse" } },
    { id: "h5", color: "wild", face: { kind: "wild-draw", count: 6 } },
    { id: "h6", color: "blue", face: { kind: "number", value: 0 } },
    { id: "h7", color: "wild", face: { kind: "wild" } },
  ]
  const half = (cards.length - 1) / 2
  return (
    <div className="relative mx-auto h-[360px] w-full max-w-[820px]">
      <div className="absolute inset-x-0 bottom-0 flex justify-center">
        {cards.map((c, i) => {
          const offset = i - half
          const isSelected = selectedId === c.id
          // Selected card straightens, lifts higher, scales up, and z-indexes above siblings.
          const rot = isSelected ? 0 : offset * 6
          const x = offset * 64
          const y = isSelected ? -90 : Math.abs(offset) * 6
          const scale = isSelected ? 1.06 : 1
          return (
            <div
              key={c.id}
              className="absolute bottom-0"
              style={{
                transform: `translateX(${x}px) translateY(${y}px) rotate(${rot}deg) scale(${scale})`,
                transitionProperty: "transform",
                transitionDuration: "480ms",
                transitionTimingFunction: "cubic-bezier(0.22, 0.9, 0.18, 1)",
                zIndex: isSelected ? 50 : 10 + i,
                willChange: "transform",
              }}
            >
              <UnoCard
                card={c}
                size="lg"
                raised={isSelected}
                onClick={() =>
                  setSelectedId((prev) => (prev === c.id ? null : c.id))
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
