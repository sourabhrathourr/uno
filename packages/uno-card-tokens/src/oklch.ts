/**
 * OKLCH → sRGB hex conversion.
 *
 * Pipeline: oklch(L, C, h°) → oklab(L, a, b) → linear sRGB → gamma-encoded sRGB → hex.
 * Matches the math browsers use for `oklch()`, so the hex we emit is what
 * Chrome / Safari would paint the same `oklch()` string as.
 */

function oklabToLinearSrgb(
  L: number,
  a: number,
  b: number,
): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return 12.92 * c
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function channelToHex(c: number): string {
  const clamped = Math.max(0, Math.min(1, c))
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
}

export function oklchToHex(L: number, C: number, h: number): string {
  const hRad = (h * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)
  const [lr, lg, lb] = oklabToLinearSrgb(L, a, b)
  return `#${channelToHex(linearToSrgb(lr))}${channelToHex(linearToSrgb(lg))}${channelToHex(linearToSrgb(lb))}`
}
