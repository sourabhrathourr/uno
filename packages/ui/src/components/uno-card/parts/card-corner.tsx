import type { CSSProperties, ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

type Position = "top-left" | "bottom-right"

type Props = {
  position: Position
  inset: number
  fontPx: number
  className?: string
  children: ReactNode
}

/**
 * Corner pip. Numbers/symbols are rendered upright — only the bottom-right
 * pip flips 180° so the card stays readable when held by the player across
 * the table. The center oval keeps its tilt independently.
 */
export function CardCorner({ position, inset, fontPx, className, children }: Props) {
  const isBottom = position === "bottom-right"

  const style: CSSProperties = {
    fontSize: fontPx,
    lineHeight: 1,
    transform: isBottom ? "rotate(180deg)" : undefined,
    transformOrigin: "center",
    fontVariantNumeric: "tabular-nums",
  }

  const positionStyle: CSSProperties = isBottom
    ? { right: inset, bottom: inset }
    : { left: inset, top: inset }

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 font-bold text-white select-none",
        className,
      )}
      style={{ ...positionStyle, ...style }}
    >
      {children}
    </div>
  )
}
