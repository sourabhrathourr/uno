/**
 * The card design tokens — palette, sizes, oval tilt, easing — live in
 * `@workspace/uno-card-tokens` so the mobile renderer can consume the same
 * source of truth. This file is a thin re-export to keep the existing public
 * surface stable for the web component.
 */
export {
  ease,
  palette,
  paletteRgb,
  sizes,
  tiltDegrees,
  type ColorRamp,
  type SizeSpec,
} from "@workspace/uno-card-tokens"
