import { GlyphCanvas } from "./glyph-shared"

/** A small fan of cards. */
function MiniFan({ count }: { count: number }) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const offset = (i - (count - 1) / 2) * 3.5
        const tilt = (i - (count - 1) / 2) * 7
        return (
          <g key={i} transform={`translate(${offset} 0) rotate(${tilt})`}>
            <rect
              x={-7}
              y={-10}
              width={14}
              height={20}
              rx={2}
              fill="white"
              stroke="black"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </g>
        )
      })}
    </g>
  )
}

/** A small face-down stack — three cards layered. */
function MiniStack() {
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={-9 - i}
          y={-12 - i}
          width={18}
          height={24}
          rx={2}
          fill="white"
          stroke="black"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ))}
    </g>
  )
}

function ArrowMark({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <path
        d="M -8 0 L 4 -5 L 4 -1.5 L 10 -1.5 L 10 1.5 L 4 1.5 L 4 5 Z"
        fill="white"
        stroke="black"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </g>
  )
}

/**
 * Discard-Color center: a hand of cards above a face-down deck, with a single
 * arrow showing the cards being thrown out of the hand into the pile.
 */
export function DiscardCenter() {
  return (
    <GlyphCanvas>
      {/* Hand of cards (spread fan), upper portion of the oval */}
      <g transform="translate(50 54) rotate(6)">
        <MiniFan count={5} />
      </g>

      {/* Arrow pointing from hand down to the deck */}
      <ArrowMark x={50} y={76} rotate={90} />

      {/* Face-down deck (stack), lower portion of the oval */}
      <g transform="translate(50 96)">
        <MiniStack />
      </g>
    </GlyphCanvas>
  )
}

export function DiscardCorner() {
  return (
    <svg
      viewBox="-14 -14 28 28"
      style={{ height: "1em", width: "1em", overflow: "visible" }}
    >
      <g transform="rotate(-15)">
        <MiniFan count={3} />
      </g>
      <ArrowMark x={10} y={-7} rotate={-20} />
    </svg>
  )
}
