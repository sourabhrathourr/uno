import type { CardColor } from "../types"
import { palette } from "../tokens"
import { GlyphCanvas } from "./glyph-shared"

/** A small colored card silhouette — used for the wild draw stack graphic. */
function ColoredMiniCard({
  x,
  y,
  rotate,
  color,
  w = 26,
  h = 36,
}: {
  x: number
  y: number
  rotate: number
  color: Exclude<CardColor, "wild">
  w?: number
  h?: number
}) {
  const ramp = palette[color]
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={3}
        fill={ramp.base}
        stroke="black"
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      {/* highlight strip for the metallic feel scaled down */}
      <rect
        x={-w / 2 + 2}
        y={-h / 2 + 2}
        width={w / 2.5}
        height={h - 4}
        rx={2}
        fill={ramp.light}
        opacity={0.55}
      />
      {/* tiny "spark" — small diamond like the No-Mercy art */}
      <path
        d="M 0 6 L 2 9 L 0 12 L -2 9 Z"
        fill="white"
        opacity={0.7}
        transform={`translate(0 -2) scale(0.8)`}
      />
    </g>
  )
}

/**
 * A messy-stack layout of N colored cards — visually selling "you draw this many".
 * Cards are pre-arranged for each count; ordering uses the canonical UNO color
 * cycle (red → blue → green → yellow) so the same color never sits next to itself.
 */
const slotMap: Record<number, Array<{ x: number; y: number; rotate: number }>> = {
  4: [
    { x: 38, y: 60, rotate: -18 },
    { x: 52, y: 56, rotate: -4 },
    { x: 64, y: 64, rotate: 12 },
    { x: 50, y: 78, rotate: -2 },
  ],
  6: [
    { x: 32, y: 58, rotate: -22 },
    { x: 46, y: 52, rotate: -8 },
    { x: 60, y: 56, rotate: 8 },
    { x: 70, y: 70, rotate: 22 },
    { x: 42, y: 78, rotate: -12 },
    { x: 58, y: 82, rotate: 14 },
  ],
  10: [
    { x: 28, y: 50, rotate: -28 },
    { x: 42, y: 46, rotate: -14 },
    { x: 56, y: 46, rotate: 0 },
    { x: 70, y: 52, rotate: 16 },
    { x: 76, y: 70, rotate: 28 },
    { x: 32, y: 70, rotate: -16 },
    { x: 46, y: 68, rotate: -2 },
    { x: 60, y: 70, rotate: 10 },
    { x: 40, y: 86, rotate: -8 },
    { x: 58, y: 88, rotate: 14 },
  ],
}

const colorCycle: Array<Exclude<CardColor, "wild">> = ["red", "blue", "green", "yellow"]

export function WildCardsCenter({ count }: { count: 4 | 6 | 10 }) {
  const slots = slotMap[count]
  return (
    <GlyphCanvas>
      {slots.map((slot, i) => (
        <ColoredMiniCard key={i} {...slot} color={colorCycle[i % colorCycle.length]} />
      ))}
    </GlyphCanvas>
  )
}

export function WildDrawCorner({ count }: { count: number }) {
  return (
    <span
      className="leading-none tabular-nums"
      style={{
        color: "white",
        WebkitTextStroke: "0.05em black",
        paintOrder: "stroke fill",
      }}
    >
      +{count}
    </span>
  )
}

/**
 * Reverse-Draw center: cards stack between two straight chunky arrows —
 * top points right, bottom points left. White fill + thick black stroke.
 */
export function WildReverseDrawCenter({ count }: { count: 4 }) {
  const arrow = (
    <path
      d="M -34 -3 L 16 -3 L 16 -13 L 36 0 L 16 13 L 16 3 L -34 3 Z"
      fill="white"
      stroke="black"
      strokeWidth={4}
      strokeLinejoin="round"
    />
  )
  return (
    <GlyphCanvas>
      {slotMap[count].map((slot, i) => (
        <ColoredMiniCard
          key={i}
          {...slot}
          color={colorCycle[i % colorCycle.length]}
          w={22}
          h={30}
        />
      ))}
      {/* Top arrow points right */}
      <g transform="translate(50 38)">{arrow}</g>
      {/* Bottom arrow flipped horizontally — points left */}
      <g transform="translate(50 102) scale(-1 1)">{arrow}</g>
    </GlyphCanvas>
  )
}

