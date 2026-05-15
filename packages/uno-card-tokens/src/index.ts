import type { CardColor } from "@workspace/game"

import { oklchToHex } from "./oklch"

export type CardSize = "sm" | "md" | "lg" | "xl"

type Ramp<T> = {
  sheen: T
  light: T
  mid: T
  base: T
  deep: T
}

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
export type ColorRamp = Ramp<string>

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

type OklchTuple = readonly [L: number, C: number, h: number]

/**
 * Source of truth — every stop authored once as numeric `[L, C, h]` and then
 * projected into two string forms below. The web renders the oklch strings
 * directly (CSS understands them and does `color-mix(in oklch, …)` against
 * them); React Native gets a parallel hex-encoded copy because the platform
 * color parser only speaks rgb / hex.
 */
const source: Record<CardColor, Ramp<OklchTuple>> = {
  red: {
    sheen: [0.94, 0.05, 30],
    light: [0.74, 0.18, 30],
    mid: [0.62, 0.22, 28],
    base: [0.54, 0.22, 27],
    deep: [0.34, 0.14, 25],
  },
  green: {
    sheen: [0.94, 0.04, 145],
    light: [0.72, 0.16, 148],
    mid: [0.58, 0.18, 148],
    base: [0.5, 0.17, 148],
    deep: [0.3, 0.1, 148],
  },
  blue: {
    sheen: [0.92, 0.05, 255],
    light: [0.66, 0.18, 258],
    mid: [0.5, 0.21, 260],
    base: [0.42, 0.21, 262],
    deep: [0.24, 0.14, 262],
  },
  yellow: {
    sheen: [0.98, 0.05, 95],
    light: [0.92, 0.14, 92],
    mid: [0.86, 0.18, 90],
    base: [0.8, 0.18, 88],
    deep: [0.58, 0.16, 80],
  },
  wild: {
    sheen: [0.42, 0.008, 270],
    light: [0.2, 0.005, 270],
    mid: [0.13, 0.004, 270],
    base: [0.09, 0.003, 270],
    deep: [0.02, 0.002, 270],
  },
}

function mapRamp(
  ramp: Ramp<OklchTuple>,
  fn: (v: OklchTuple) => string,
): ColorRamp {
  return {
    sheen: fn(ramp.sheen),
    light: fn(ramp.light),
    mid: fn(ramp.mid),
    base: fn(ramp.base),
    deep: fn(ramp.deep),
  }
}

function mapPalette(
  fn: (v: OklchTuple) => string,
): Record<CardColor, ColorRamp> {
  return {
    red: mapRamp(source.red, fn),
    green: mapRamp(source.green, fn),
    blue: mapRamp(source.blue, fn),
    yellow: mapRamp(source.yellow, fn),
    wild: mapRamp(source.wild, fn),
  }
}

const toOklchString = ([L, C, h]: OklchTuple) => `oklch(${L} ${C} ${h})`
const toHexString = ([L, C, h]: OklchTuple) => oklchToHex(L, C, h)

/** CSS `oklch(...)` strings — the canonical representation, used by the web app. */
export const palette: Record<CardColor, ColorRamp> = mapPalette(toOklchString)

/** Hex `#rrggbb` strings — the same palette resolved to sRGB for React Native. */
export const paletteRgb: Record<CardColor, ColorRamp> = mapPalette(toHexString)

/**
 * The center "UNO oval" tilts so its long axis runs from upper-right to
 * lower-left — the empty diagonal. The number pips at top-left and
 * bottom-right corners sit outside the oval as a result.
 */
export const tiltDegrees = 18

export const sizes: Record<CardSize, SizeSpec> = {
  sm: {
    width: 72,
    height: 102,
    radius: 8,
    borderWidth: 3,
    centerFontPx: 38,
    cornerFontPx: 14,
    cornerInset: 5,
  },
  md: {
    width: 120,
    height: 170,
    radius: 12,
    borderWidth: 4,
    centerFontPx: 64,
    cornerFontPx: 22,
    cornerInset: 7,
  },
  lg: {
    width: 168,
    height: 238,
    radius: 16,
    borderWidth: 6,
    centerFontPx: 90,
    cornerFontPx: 30,
    cornerInset: 10,
  },
  xl: {
    width: 224,
    height: 318,
    radius: 22,
    borderWidth: 8,
    centerFontPx: 120,
    cornerFontPx: 40,
    cornerInset: 13,
  },
}

/** Easing used everywhere — spring-like decel without overshoot. */
export const ease = "cubic-bezier(0.2, 0, 0, 1)"
