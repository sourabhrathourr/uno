import { GlyphCanvas } from "./glyph-shared"

/**
 * The no-entry sign. Drawn as two stacked strokes — black under, white over —
 * so the white reads cleanly while keeping a thick outline.
 */
function SkipMark({
  cx,
  cy,
  r,
  outerWidth,
  innerWidth,
}: {
  cx: number
  cy: number
  r: number
  outerWidth: number
  innerWidth: number
}) {
  const slashOffset = r * 0.74
  return (
    <>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="black"
        strokeWidth={outerWidth}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="white"
        strokeWidth={innerWidth}
      />
      <line
        x1={cx - slashOffset}
        y1={cy - slashOffset}
        x2={cx + slashOffset}
        y2={cy + slashOffset}
        stroke="black"
        strokeWidth={outerWidth}
        strokeLinecap="round"
      />
      <line
        x1={cx - slashOffset}
        y1={cy - slashOffset}
        x2={cx + slashOffset}
        y2={cy + slashOffset}
        stroke="white"
        strokeWidth={innerWidth}
        strokeLinecap="round"
      />
    </>
  )
}

export function SkipCenter() {
  return (
    <GlyphCanvas>
      <SkipMark cx={50} cy={70} r={30} outerWidth={14} innerWidth={9} />
    </GlyphCanvas>
  )
}

export function SkipEveryoneCenter() {
  return (
    <GlyphCanvas>
      <g transform="translate(46 70)">
        <SkipEveryoneMark />
      </g>
    </GlyphCanvas>
  )
}

/** One clockwise loop arrow, with an open gap below its arrowhead. */
function SkipEveryoneMark() {
  return (
    <path
      d="M 22.5 26.8 A 35 35 0 1 1 35 0 L 44 0 L 30 18 L 16 0 L 25 0 A 25 25 0 1 0 16.1 19.2 A 5 5 0 0 1 22.5 26.8 Z"
      fill="white"
      stroke="black"
      strokeWidth={4.5}
      strokeLinejoin="round"
    />
  )
}

export function SkipEveryoneCorner() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1em] w-[1em]">
      <g transform="translate(11 12) scale(0.25)">
        <SkipEveryoneMark />
      </g>
    </svg>
  )
}

export function SkipCorner() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1em] w-[1em]">
      <SkipMark cx={12} cy={12} r={9} outerWidth={4.5} innerWidth={2.5} />
    </svg>
  )
}
