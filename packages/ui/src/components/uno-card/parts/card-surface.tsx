import type { CSSProperties, ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import type { CardColor } from "../types"
import { palette } from "../tokens"

type Props = {
  color: CardColor
  width: number
  height: number
  radius: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * The metallic colored body that sits inside the black card frame.
 * Builds the anodized look from five stacked layers and a soft inner bevel.
 * The outer frame + drop shadow are owned by the parent UnoCard wrapper.
 */
export function CardSurface({ color, width, height, radius, className, style, children }: Props) {
  const ramp = palette[color]

  const surfaceStyle: CSSProperties = {
    width,
    height,
    borderRadius: radius,
    backgroundColor: ramp.base,
    backgroundImage: [
      // 1. Specular catch — soft ellipse near the top-left corner.
      `radial-gradient(ellipse 70% 55% at 22% 14%, color-mix(in oklch, ${ramp.sheen} 55%, transparent) 0%, transparent 60%)`,
      // 2. Brushed-metal vertical streaks — extremely subtle, breaks up flat fills.
      `repeating-linear-gradient(92deg, transparent 0 2px, color-mix(in oklch, ${ramp.sheen} 4%, transparent) 2px 3px)`,
      // 3. Anodized diagonal sweep — the core of the metallic feel.
      `linear-gradient(135deg, ${ramp.deep} 0%, ${ramp.base} 22%, ${ramp.mid} 48%, ${ramp.light} 60%, ${ramp.mid} 74%, ${ramp.base} 88%, ${ramp.deep} 100%)`,
    ].join(", "),
    boxShadow: [
      // Inner bevel only — the outer rim and drop shadow are on the black frame.
      `inset 0 1px 0 0 color-mix(in oklch, ${ramp.sheen} 55%, transparent)`,
      `inset 0 -1px 0 0 color-mix(in oklch, ${ramp.deep} 70%, transparent)`,
      `inset 1px 0 0 0 color-mix(in oklch, ${ramp.light} 28%, transparent)`,
      `inset -1px 0 0 0 color-mix(in oklch, ${ramp.deep} 45%, transparent)`,
    ].join(", "),
    ...style,
  }

  return (
    <div className={cn("relative overflow-hidden", className)} style={surfaceStyle}>
      {/* Glossy top-edge highlight — a thin streak that hugs the upper bevel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
        style={{
          background: `linear-gradient(to bottom, color-mix(in oklch, ${ramp.sheen} 22%, transparent) 0%, transparent 70%)`,
          mixBlendMode: "screen",
        }}
      />
      {/* Bottom-right shadow plate — adds weight without darkening the body. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 90% 70% at 100% 100%, color-mix(in oklch, ${ramp.deep} 50%, transparent) 0%, transparent 55%)`,
          mixBlendMode: "multiply",
        }}
      />
      {children}
    </div>
  )
}
