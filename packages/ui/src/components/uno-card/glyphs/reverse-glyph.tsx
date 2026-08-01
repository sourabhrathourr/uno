import { GlyphCanvas } from "./glyph-shared"

/**
 * Two arrows looping back on each other — UNO's reverse mark. Shapes are
 * stacked black-then-white the same way Skip is, for the chunky outline.
 */
function ReverseMark({
  scale,
  cx,
  cy,
}: {
  scale: number
  cx: number
  cy: number
}) {
  // Two thick arrows facing opposite directions, slightly offset.
  // Drawn as polygons so the heads keep a bold silhouette.
  const top = (
    <path
      d="M -22 -6 L 8 -6 L 8 -16 L 26 -2 L 8 12 L 8 2 L -22 2 Z"
      fill="white"
      stroke="black"
      strokeWidth={4}
      strokeLinejoin="round"
    />
  )
  const bottom = (
    <path
      d="M 22 6 L -8 6 L -8 16 L -26 2 L -8 -12 L -8 -2 L 22 -2 Z"
      fill="white"
      stroke="black"
      strokeWidth={4}
      strokeLinejoin="round"
    />
  )
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <g transform="translate(0 -10)">{top}</g>
      <g transform="translate(0 10)">{bottom}</g>
    </g>
  )
}

export function ReverseCenter() {
  return (
    <GlyphCanvas>
      <ReverseMark cx={50} cy={70} scale={1.5} />
    </GlyphCanvas>
  )
}

export function ReverseCorner() {
  return (
    <svg viewBox="-26 -26 52 52" className="h-[1.2em] w-[1.2em]">
      <ReverseMark cx={0} cy={0} scale={0.65} />
    </svg>
  )
}
