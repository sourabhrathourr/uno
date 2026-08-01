import { palette } from "../tokens"
import { GlyphCanvas } from "./glyph-shared"

/**
 * Four colored splotches arranged like a clover — UNO's wild signature.
 * Each splotch is a mini ellipse echoing the central white oval.
 */
function WildClover({
  cx,
  cy,
  scale,
}: {
  cx: number
  cy: number
  scale: number
}) {
  const splotches: Array<{
    dx: number
    dy: number
    color: keyof typeof palette
  }> = [
    { dx: 0, dy: -16, color: "red" },
    { dx: 16, dy: 0, color: "blue" },
    { dx: 0, dy: 16, color: "green" },
    { dx: -16, dy: 0, color: "yellow" },
  ]
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      {splotches.map((s) => (
        <g key={s.color} transform={`translate(${s.dx} ${s.dy})`}>
          <ellipse
            rx="14"
            ry="11"
            fill={palette[s.color].base}
            stroke="black"
            strokeWidth={3}
          />
          {/* tiny inner highlight to keep them from looking flat */}
          <ellipse
            rx="14"
            ry="11"
            fill={palette[s.color].light}
            opacity="0.45"
            transform="translate(-3 -3) scale(0.7)"
          />
        </g>
      ))}
    </g>
  )
}

export function WildCenter() {
  return (
    <GlyphCanvas>
      <WildClover cx={50} cy={70} scale={1.5} />
    </GlyphCanvas>
  )
}

export function WildCorner() {
  return (
    <svg viewBox="-30 -30 60 60" className="h-[1.4em] w-[1.4em]">
      <WildClover cx={0} cy={0} scale={0.85} />
    </svg>
  )
}

export function WildRouletteCenter() {
  return (
    <GlyphCanvas>
      <WildClover cx={50} cy={58} scale={1.15} />
      <path
        d="M 30 98 A 26 26 0 0 0 76 86"
        fill="none"
        stroke="black"
        strokeWidth={12}
        strokeLinecap="round"
      />
      <path
        d="M 30 98 A 26 26 0 0 0 76 86"
        fill="none"
        stroke="white"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d="M 74 73 L 87 88 L 68 92 Z"
        fill="white"
        stroke="black"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </GlyphCanvas>
  )
}

export function WildRouletteCorner() {
  return (
    <svg viewBox="-30 -30 60 60" className="h-[1.4em] w-[1.4em]">
      <WildClover cx={0} cy={-4} scale={0.55} />
      <path
        d="M -16 17 A 20 20 0 0 0 18 10"
        fill="none"
        stroke="black"
        strokeWidth={9}
        strokeLinecap="round"
      />
      <path
        d="M -16 17 A 20 20 0 0 0 18 10"
        fill="none"
        stroke="white"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path
        d="M 17 -2 L 27 11 L 11 14 Z"
        fill="white"
        stroke="black"
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  )
}
