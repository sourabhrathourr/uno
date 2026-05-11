import type { ReactNode } from "react"

/**
 * Shared SVG canvas for center glyphs. Every glyph draws into this 100×140
 * viewBox so the strokes stay proportional to the card. `overflow="visible"`
 * lets the stroke bleed past the edge — important for thick outlines.
 */
export function GlyphCanvas({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 100 140"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      overflow="visible"
    >
      {children}
    </svg>
  )
}

/** UNO white-on-color text style: thick black stroke painted under a white fill. */
export const glyphTextProps = {
  fill: "white",
  stroke: "black",
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
  paintOrder: "stroke fill" as const,
  fontWeight: 900,
  fontFamily:
    "Geist Variable, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
}
