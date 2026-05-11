import type { ReactNode } from "react"

import { tiltDegrees } from "../tokens"

export type OvalMode =
  | "color-ring" // black ring + white inside (colored cards)
  | "white-only" // smaller plain white oval (wild cards)
  | "hidden" //     graphic dominates the whole face

type Props = {
  mode: OvalMode
  children: ReactNode
}

/**
 * The signature UNO ellipse plus the upright glyph.
 *
 * - The oval(s) are drawn into the SVG and rotated by `tiltDegrees` via a
 *   transform on a `<g>` element — this keeps the iconic tilt without
 *   rotating the glyph that sits on top.
 * - The glyph is rendered into a separate centered layer so numbers and
 *   action symbols read upright (per the No Mercy print).
 * - "color-ring" draws a slightly bigger black ellipse under the white one
 *   so the gap between them reads as a thick ring touching the diagonal
 *   edges of the colored body.
 */
export function CardCenter({ mode, children }: Props) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {mode !== "hidden" && (
        <svg
          viewBox="0 0 100 140"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            <radialGradient id="oval-shade" cx="40%" cy="30%" r="80%">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="80%" stopColor="black" stopOpacity="0.04" />
              <stop offset="100%" stopColor="black" stopOpacity="0.12" />
            </radialGradient>
          </defs>

          <g transform={`rotate(${tiltDegrees} 50 70)`}>
            {mode === "color-ring" && (
              // Just a black ring — the colored body shows through inside it.
              <ellipse
                cx="50"
                cy="70"
                rx="41"
                ry="69"
                fill="none"
                stroke="black"
                strokeWidth="5.5"
              />
            )}
            {mode === "white-only" && (
              <>
                <ellipse cx="50" cy="70" rx="30" ry="48" fill="white" />
                {/* Subtle inner shading — gives the plastic-print depth. */}
                <ellipse
                  cx="50"
                  cy="70"
                  rx="30"
                  ry="48"
                  fill="url(#oval-shade)"
                  opacity={0.4}
                />
              </>
            )}
          </g>
        </svg>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          style={{
            width: "76%",
            height: "76%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
