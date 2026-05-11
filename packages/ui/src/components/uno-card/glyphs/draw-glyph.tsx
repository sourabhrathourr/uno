import { GlyphCanvas } from "./glyph-shared"

/** A small white card silhouette with chunky black outline. */
function MiniCard({
  x,
  y,
  rotate,
  w = 28,
  h = 38,
}: {
  x: number
  y: number
  rotate: number
  w?: number
  h?: number
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={3}
        fill="white"
        stroke="black"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </g>
  )
}

/**
 * Center for colored Draw-N cards: a fan of mini-cards. Number `count` of them
 * spread evenly across an arc — visually communicates "you are taking N cards".
 */
export function DrawCenter({ count }: { count: 2 | 4 }) {
  const layouts: Record<2 | 4, Array<{ x: number; y: number; rotate: number }>> = {
    2: [
      { x: 38, y: 70, rotate: -10 },
      { x: 62, y: 70, rotate: 10 },
    ],
    4: [
      { x: 32, y: 74, rotate: -22 },
      { x: 44, y: 66, rotate: -8 },
      { x: 58, y: 66, rotate: 8 },
      { x: 70, y: 74, rotate: 22 },
    ],
  }
  return (
    <GlyphCanvas>
      {layouts[count].map((slot, i) => (
        <MiniCard key={i} {...slot} />
      ))}
    </GlyphCanvas>
  )
}

export function DrawCorner({ count }: { count: number }) {
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

