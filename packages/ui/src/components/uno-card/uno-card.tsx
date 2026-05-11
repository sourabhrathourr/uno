import type { CSSProperties, MouseEvent, PointerEvent } from "react"
import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { CardBack } from "./parts/card-back"
import { CardCenter } from "./parts/card-center"
import { CardCorner } from "./parts/card-corner"
import { CardSurface } from "./parts/card-surface"
import { GlyphCenter, GlyphCorner, ovalModeFor } from "./glyphs"
import { ease, sizes } from "./tokens"
import type { Card, CardSize } from "./types"

type Props = {
  card: Card
  size?: CardSize
  /** Renders the back instead of the face. */
  faceDown?: boolean
  /** Visually elevates the card — for the "selected" / "playable" state. */
  raised?: boolean
  /** Disable click and dim the card. */
  disabled?: boolean
  /** Disable the press scale — useful in static layouts. */
  static?: boolean
  className?: string
  style?: CSSProperties
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (e: PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (e: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (e: PointerEvent<HTMLButtonElement>) => void
  ariaLabel?: string
}

/**
 * The foundation card. Composes a black outer frame, a metallic colored body,
 * and a tilted oval with an upright glyph and corner pips.
 *
 * Interaction: hover lifts a few px, press taps to 0.96, focus shows a ring.
 * Animations are interruptible CSS transitions on transform only.
 */
export function UnoCard({
  card,
  size = "md",
  faceDown = false,
  raised = false,
  disabled = false,
  static: isStatic = false,
  className,
  style,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ariaLabel,
}: Props) {
  const [hovered, setHovered] = useState(false)
  const dim = sizes[size]
  const surfaceColor = faceDown ? "wild" : card.color

  const liftY = raised ? -8 : hovered && !disabled ? -3 : 0

  const wrapperStyle: CSSProperties = {
    width: dim.width,
    height: dim.height,
    borderRadius: dim.radius,
    transform: `translateY(${liftY}px)`,
    transitionProperty: "transform",
    transitionDuration: "180ms",
    transitionTimingFunction: ease,
    boxShadow: [
      // Outer rim — defines the silhouette against any bg.
      `0 0 0 0.5px rgba(0, 0, 0, 0.4)`,
      // Drop shadow — three layers, climbing in blur and offset.
      `0 1px 1px rgba(0, 0, 0, 0.18)`,
      `0 4px 8px -2px rgba(0, 0, 0, 0.22)`,
      `0 14px 28px -10px rgba(0, 0, 0, 0.34)`,
    ].join(", "),
    ...style,
  }

  const isInteractive = Boolean(onClick) && !disabled
  const ovalMode = faceDown ? "hidden" : ovalModeFor(card.face, card.color)

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? labelFor(card, faceDown)}
      onClick={isInteractive ? onClick : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onBlur={() => setHovered(false)}
      className={cn(
        "group relative inline-block border-0 bg-transparent p-0 outline-none",
        "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        !isStatic && !disabled && "active:[transform:translateY(0)_scale(0.96)]",
        disabled && "cursor-not-allowed opacity-55",
        !isInteractive && !disabled && "cursor-default",
        className,
      )}
      style={wrapperStyle}
    >
      <CardSurface
        color={surfaceColor}
        width={dim.width}
        height={dim.height}
        radius={dim.radius}
      >
        {faceDown ? (
          <CardBack />
        ) : (
          <>
            <CardCenter mode={ovalMode}>
              <GlyphCenter face={card.face} />
            </CardCenter>
            <CardCorner position="top-left" inset={dim.cornerInset} fontPx={dim.cornerFontPx}>
              <GlyphCorner face={card.face} />
            </CardCorner>
            <CardCorner
              position="bottom-right"
              inset={dim.cornerInset}
              fontPx={dim.cornerFontPx}
            >
              <GlyphCorner face={card.face} />
            </CardCorner>
          </>
        )}
      </CardSurface>
    </button>
  )
}

function labelFor(card: Card, faceDown: boolean): string {
  if (faceDown) return "Face-down UNO card"
  const color = card.color === "wild" ? "Wild" : capitalize(card.color)
  const face = card.face
  switch (face.kind) {
    case "number":
      return `${color} ${face.value}`
    case "skip":
      return `${color} Skip`
    case "skip-everyone":
      return `${color} Skip Everyone`
    case "reverse":
      return `${color} Reverse`
    case "draw":
      return `${color} Draw ${face.count}`
    case "discard-color":
      return `${color} Discard Color`
    case "wild":
      return "Wild"
    case "wild-draw":
      return `Wild Draw ${face.count}`
    case "wild-reverse-draw":
      return `Wild Reverse Draw ${face.count}`
    case "wild-color-roulette":
      return "Wild Color Roulette"
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
