import { GlyphCanvas, glyphTextProps } from "./glyph-shared"
import type { NumberValue } from "../types"

export function NumberCenter({ value }: { value: NumberValue }) {
  return (
    <GlyphCanvas>
      <text
        x="50"
        y="70"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="92"
        strokeWidth="9"
        {...glyphTextProps}
      >
        {value}
      </text>
    </GlyphCanvas>
  )
}

export function NumberCorner({ value }: { value: NumberValue }) {
  return (
    <div
      className="flex flex-col items-center leading-none tabular-nums"
      style={{ gap: "0.08em" }}
    >
      <span
        className="block"
        style={{
          color: "white",
          WebkitTextStroke: "0.05em black",
          paintOrder: "stroke fill",
        }}
      >
        {value}
      </span>
      {/* No Mercy rule indicators — every 7 swaps hands, every 0 rotates them. */}
      {value === 7 && <SwapArrowsCorner />}
      {value === 0 && <RotateLoopCorner />}
    </div>
  )
}

function SwapArrowsCorner() {
  return (
    <svg
      viewBox="-14 -4 28 8"
      style={{ height: "0.34em", width: "1.1em", overflow: "visible" }}
    >
      {/* Left-pointing arrow */}
      <path
        d="M -13 0 L -5 -3.5 L -5 -1 L 0 -1 L 0 1 L -5 1 L -5 3.5 Z"
        fill="white"
        stroke="black"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Right-pointing arrow */}
      <path
        d="M 13 0 L 5 -3.5 L 5 -1 L 0 -1 L 0 1 L 5 1 L 5 3.5 Z"
        fill="white"
        stroke="black"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RotateLoopCorner() {
  return (
    <svg
      viewBox="-9 -9 18 18"
      style={{ height: "0.65em", width: "0.65em", overflow: "visible" }}
    >
      {/* Outer black arc — almost a full circle, opening at the bottom */}
      <path
        d="M 0,-6 A 6,6 0 1,1 -1.5,5.8"
        fill="none"
        stroke="black"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Inner white arc on top creates the chunky outlined look */}
      <path
        d="M 0,-6 A 6,6 0 1,1 -1.5,5.8"
        fill="none"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Arrowhead triangle at the arc tail */}
      <path
        d="M -1.5,5.8 L -5,3 L 1,2 Z"
        fill="white"
        stroke="black"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
