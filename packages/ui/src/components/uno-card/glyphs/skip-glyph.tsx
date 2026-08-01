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
      <SkipMark cx={34} cy={62} r={18} outerWidth={9} innerWidth={5.5} />
      <SkipMark cx={66} cy={62} r={18} outerWidth={9} innerWidth={5.5} />
      <SkipMark cx={50} cy={92} r={18} outerWidth={9} innerWidth={5.5} />
    </GlyphCanvas>
  )
}

export function SkipCorner() {
  return (
    <svg viewBox="0 0 24 24" className="h-[1em] w-[1em]">
      <SkipMark cx={12} cy={12} r={9} outerWidth={4.5} innerWidth={2.5} />
    </svg>
  )
}
