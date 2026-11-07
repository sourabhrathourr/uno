import { CanvasTexture, SRGBColorSpace } from "three"
import { palette, paletteRgb } from "@workspace/uno-card-tokens"
import type { Card } from "@workspace/game"

/**
 * Canvas-drawn textures: card faces in the game's own colours, name tags,
 * chat bubbles and neon signs. Cached, since the same card or name is drawn
 * many times.
 */

const cache = new Map<string, CanvasTexture>()

function cached(key: string, draw: () => HTMLCanvasElement) {
  const hit = cache.get(key)
  if (hit) return hit
  const texture = new CanvasTexture(draw())
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  if (cache.size > 300) {
    const oldest = cache.keys().next()
    if (!oldest.done) {
      cache.get(oldest.value)?.dispose()
      cache.delete(oldest.value)
    }
  }
  cache.set(key, texture)
  return texture
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas")
  element.width = width
  element.height = height
  return [element, element.getContext("2d")!] as const
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** CSS colour for a canvas: canvases understand oklch in modern browsers. */
function cssColor(value: string, fallback: string) {
  if (typeof CSS !== "undefined" && CSS.supports("color", value)) return value
  return fallback
}

const FALLBACK: Record<string, string> = {
  red: "#d42a2a",
  green: "#239a3b",
  blue: "#1f4fd1",
  yellow: "#f2c40f",
  wild: "#111111",
}

/** Hex for three.js, which can't parse oklch(). */
export function cardColorHex(color: Card["color"]) {
  return paletteRgb[color].base
}

export function cardColorCss(color: Card["color"]) {
  return cssColor(palette[color].base, FALLBACK[color])
}

function faceGlyph(card: Card): { center: string; corner: string } {
  const face = card.face
  switch (face.kind) {
    case "number":
      return { center: String(face.value), corner: String(face.value) }
    case "skip":
      return { center: "⊘", corner: "⊘" }
    case "skip-everyone":
      return { center: "⊘⊘", corner: "⊘⊘" }
    case "reverse":
      return { center: "⇄", corner: "⇄" }
    case "draw":
      return { center: `+${face.count}`, corner: `+${face.count}` }
    case "discard-color":
      return { center: "≋", corner: "≋" }
    case "wild":
      return { center: "W", corner: "W" }
    case "wild-draw":
      return { center: `+${face.count}`, corner: `+${face.count}` }
    case "wild-reverse-draw":
      return { center: `⇄${face.count}`, corner: `⇄${face.count}` }
    case "wild-color-roulette":
      return { center: "?", corner: "?" }
  }
}

const W = 256
const H = 362

export function cardFaceTexture(card: Card) {
  const glyph = faceGlyph(card)
  return cached(`card:${card.color}:${glyph.center}`, () => {
    const [element, ctx] = canvas(W, H)
    const ramp = palette[card.color]
    const fallback = FALLBACK[card.color]
    roundRect(ctx, 0, 0, W, H, 26)
    ctx.fillStyle = "#0b0b0b"
    ctx.fill()

    const inset = 12
    roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 18)
    const body = ctx.createLinearGradient(0, 0, W, H)
    body.addColorStop(0, cssColor(ramp.light, fallback))
    body.addColorStop(0.45, cssColor(ramp.mid, fallback))
    body.addColorStop(1, cssColor(ramp.deep, fallback))
    ctx.fillStyle = body
    ctx.fill()

    // The tilted UNO oval.
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate((18 * Math.PI) / 180)
    ctx.scale(1, 1.55)
    ctx.beginPath()
    ctx.arc(0, 0, 86, 0, Math.PI * 2)
    ctx.restore()
    if (card.color === "wild") {
      ctx.save()
      ctx.clip()
      const quadrants = ["red", "yellow", "green", "blue"] as const
      quadrants.forEach((color, index) => {
        ctx.fillStyle = cardColorCss(color)
        ctx.fillRect(
          index % 2 === 0 ? 0 : W / 2,
          index < 2 ? 0 : H / 2,
          W / 2,
          H / 2
        )
      })
      ctx.restore()
    } else {
      ctx.fillStyle = "#fbfaf7"
      ctx.fill()
    }

    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const centerSize =
      glyph.center.length > 2 ? 78 : glyph.center.length > 1 ? 104 : 140
    ctx.font = `900 ${centerSize}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`
    ctx.lineWidth = 12
    ctx.strokeStyle = "#0b0b0b"
    ctx.lineJoin = "round"
    ctx.strokeText(glyph.center, W / 2, H / 2 + 6)
    ctx.fillStyle =
      card.color === "wild" ? "#ffffff" : cssColor(ramp.base, fallback)
    ctx.fillText(glyph.center, W / 2, H / 2 + 6)

    ctx.font = `800 38px ui-rounded, system-ui, sans-serif`
    ctx.fillStyle = "#ffffff"
    ctx.lineWidth = 6
    ctx.strokeText(glyph.corner, 46, 50)
    ctx.fillText(glyph.corner, 46, 50)
    ctx.save()
    ctx.translate(W - 46, H - 50)
    ctx.rotate(Math.PI)
    ctx.strokeText(glyph.corner, 0, 0)
    ctx.fillText(glyph.corner, 0, 0)
    ctx.restore()
    return element
  })
}

export function cardBackTexture() {
  return cached("card:back", () => {
    const [element, ctx] = canvas(W, H)
    roundRect(ctx, 0, 0, W, H, 26)
    ctx.fillStyle = "#0b0b0b"
    ctx.fill()
    roundRect(ctx, 12, 12, W - 24, H - 24, 18)
    ctx.fillStyle = "#151515"
    ctx.fill()
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate((18 * Math.PI) / 180)
    ctx.scale(1, 1.55)
    ctx.beginPath()
    ctx.arc(0, 0, 84, 0, Math.PI * 2)
    ctx.restore()
    ctx.fillStyle = cardColorCss("red")
    ctx.fill()
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate((-14 * Math.PI) / 180)
    ctx.font = `italic 900 70px ui-rounded, system-ui, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineWidth = 10
    ctx.strokeStyle = "#0b0b0b"
    ctx.strokeText("UNO", 0, 0)
    ctx.fillStyle = cardColorCss("yellow")
    ctx.fillText("UNO", 0, 0)
    ctx.restore()
    return element
  })
}

export type LabelOptions = {
  background?: string
  color?: string
  ring?: string | null
  size?: number
}

/** A pill-shaped name tag. Returns the texture and its aspect ratio. */
export function labelTexture(text: string, options: LabelOptions = {}) {
  const size = options.size ?? 44
  const key = `label:${text}:${options.background}:${options.color}:${options.ring}:${size}`
  let aspect = 1
  const texture = cached(key, () => {
    const [probe, probeCtx] = canvas(8, 8)
    void probe
    probeCtx.font = `700 ${size}px system-ui, sans-serif`
    const width = Math.ceil(probeCtx.measureText(text).width + size * 1.3)
    const height = Math.ceil(size * 1.7)
    const [element, ctx] = canvas(width, height)
    roundRect(ctx, 3, 3, width - 6, height - 6, (height - 6) / 2)
    ctx.fillStyle = options.background ?? "rgba(10,9,8,0.72)"
    ctx.fill()
    if (options.ring) {
      ctx.lineWidth = 5
      ctx.strokeStyle = options.ring
      ctx.stroke()
    }
    ctx.font = `700 ${size}px system-ui, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = options.color ?? "#ffffff"
    ctx.fillText(text, width / 2, height / 2 + size * 0.04)
    return element
  })
  const image = texture.image
  aspect = image.width / image.height
  return { texture, aspect }
}

/** A speech bubble with wrapped text, for chat above heads. */
export function bubbleTexture(text: string) {
  const clipped = text.length > 90 ? text.slice(0, 88) + "…" : text
  const key = `bubble:${clipped}`
  const texture = cached(key, () => {
    const size = 34
    const maxWidth = 460
    const [, probeCtx] = canvas(8, 8)
    probeCtx.font = `600 ${size}px system-ui, sans-serif`
    const lines: Array<string> = []
    let line = ""
    for (const word of clipped.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (probeCtx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
    const shown = lines.slice(0, 3)
    const textWidth = Math.max(
      ...shown.map((l) => probeCtx.measureText(l).width)
    )
    const width = Math.ceil(textWidth + 56)
    const height = Math.ceil(shown.length * size * 1.25 + 44 + 18)
    const [element, ctx] = canvas(width, height)
    roundRect(ctx, 2, 2, width - 4, height - 22, 26)
    ctx.fillStyle = "rgba(255,255,255,0.95)"
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(width / 2 - 16, height - 21)
    ctx.lineTo(width / 2, height - 2)
    ctx.lineTo(width / 2 + 16, height - 21)
    ctx.fill()
    ctx.font = `600 ${size}px system-ui, sans-serif`
    ctx.fillStyle = "#111"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    shown.forEach((l, index) =>
      ctx.fillText(l, width / 2, 24 + size * 0.62 + index * size * 1.25)
    )
    return element
  })
  const image = texture.image
  return { texture, aspect: image.width / image.height }
}

/** Glowing script for the neon signs on the walls. */
export function neonTexture(text: string, color: string) {
  return cached(`neon:${text}:${color}`, () => {
    const size = 120
    const [, probeCtx] = canvas(8, 8)
    probeCtx.font = `italic 800 ${size}px "Brush Script MT", "Snell Roundhand", cursive`
    const width = Math.ceil(probeCtx.measureText(text).width + 120)
    const height = 220
    const [element, ctx] = canvas(width, height)
    ctx.font = probeCtx.font
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.shadowColor = color
    for (const blur of [40, 20, 8]) {
      ctx.shadowBlur = blur
      ctx.fillStyle = color
      ctx.fillText(text, width / 2, height / 2)
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = "#ffffff"
    ctx.globalAlpha = 0.85
    ctx.fillText(text, width / 2, height / 2)
    return element
  })
}

/** White-on-black title strip for the LED wall marquee. */
export function marqueeTexture(text: string) {
  const texture = cached(`marquee:${text}`, () => {
    const size = 44
    const [, probeCtx] = canvas(8, 8)
    probeCtx.font = `800 ${size}px system-ui, sans-serif`
    const width = Math.ceil(probeCtx.measureText(text).width + size * 4)
    const [element, ctx] = canvas(width, 64)
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, width, 64)
    ctx.font = probeCtx.font
    ctx.fillStyle = "#fff"
    ctx.textBaseline = "middle"
    ctx.fillText(text, size * 2, 34)
    return element
  })
  const image = texture.image
  return { texture, aspect: image.width / image.height }
}

/** Soft rounded halo drawn behind a picked-up card. */
export function cardGlowTexture() {
  return cached("card:glow", () => {
    const [element, ctx] = canvas(160, 210)
    ctx.shadowColor = "rgba(255,255,255,1)"
    ctx.shadowBlur = 22
    roundRect(ctx, 26, 26, 108, 158, 16)
    ctx.fillStyle = "rgba(255,255,255,0.9)"
    ctx.fill()
    return element
  })
}
