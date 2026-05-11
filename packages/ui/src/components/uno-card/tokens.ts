import type { CardColor, CardSize } from "./types"

/**
 * Five-stop palette per color. Read top-to-bottom as the journey light takes
 * from the brightest catch on the top-left bevel down to the recessed bottom-right.
 *
 * - sheen:  near-white catch for specular highlights
 * - light:  upper bevel + secondary catch
 * - mid:    body of the gradient where it reads as "the color"
 * - base:   the canonical brand color
 * - deep:   shadowed bottom-right + bevel underside
 */
export type ColorRamp = {
  sheen: string
  light: string
  mid: string
  base: string
  deep: string
}

export const palette: Record<CardColor, ColorRamp> = {
  red: {
    sheen: "oklch(0.94 0.05 30)",
    light: "oklch(0.74 0.18 30)",
    mid: "oklch(0.62 0.22 28)",
    base: "oklch(0.54 0.22 27)",
    deep: "oklch(0.34 0.14 25)",
  },
  green: {
    sheen: "oklch(0.94 0.04 145)",
    light: "oklch(0.72 0.16 148)",
    mid: "oklch(0.58 0.18 148)",
    base: "oklch(0.50 0.17 148)",
    deep: "oklch(0.30 0.10 148)",
  },
  blue: {
    sheen: "oklch(0.92 0.05 255)",
    light: "oklch(0.66 0.18 258)",
    mid: "oklch(0.50 0.21 260)",
    base: "oklch(0.42 0.21 262)",
    deep: "oklch(0.24 0.14 262)",
  },
  yellow: {
    sheen: "oklch(0.98 0.05 95)",
    light: "oklch(0.92 0.14 92)",
    mid: "oklch(0.86 0.18 90)",
    base: "oklch(0.80 0.18 88)",
    deep: "oklch(0.58 0.16 80)",
  },
  wild: {
    sheen: "oklch(0.42 0.008 270)",
    light: "oklch(0.20 0.005 270)",
    mid: "oklch(0.13 0.004 270)",
    base: "oklch(0.09 0.003 270)",
    deep: "oklch(0.02 0.002 270)",
  },
}

/**
 * The center "UNO oval" tilts so its long axis runs from upper-right to
 * lower-left — the empty diagonal. The number pips at top-left and
 * bottom-right corners sit outside the oval as a result.
 */
export const tiltDegrees = 18

export type SizeSpec = {
  width: number
  height: number
  radius: number
  /** Thickness of the outer black frame that wraps the colored body. */
  borderWidth: number
  centerFontPx: number
  cornerFontPx: number
  cornerInset: number
}

export const sizes: Record<CardSize, SizeSpec> = {
  sm: { width: 72, height: 102, radius: 8, borderWidth: 3, centerFontPx: 38, cornerFontPx: 14, cornerInset: 5 },
  md: { width: 120, height: 170, radius: 12, borderWidth: 4, centerFontPx: 64, cornerFontPx: 22, cornerInset: 7 },
  lg: { width: 168, height: 238, radius: 16, borderWidth: 6, centerFontPx: 90, cornerFontPx: 30, cornerInset: 10 },
  xl: { width: 224, height: 318, radius: 22, borderWidth: 8, centerFontPx: 120, cornerFontPx: 40, cornerInset: 13 },
}

/** Easing used everywhere — spring-like decel without overshoot. */
export const ease = "cubic-bezier(0.2, 0, 0, 1)"
