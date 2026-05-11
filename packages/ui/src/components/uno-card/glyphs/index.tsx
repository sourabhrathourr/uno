import type { OvalMode } from "../parts/card-center"
import type { CardColor, CardFace } from "../types"
import { NumberCenter, NumberCorner } from "./number-glyph"
import { SkipCenter, SkipCorner, SkipEveryoneCenter } from "./skip-glyph"
import { ReverseCenter, ReverseCorner } from "./reverse-glyph"
import { DrawCenter, DrawCorner } from "./draw-glyph"
import {
  WildCenter,
  WildCorner,
  WildRouletteCenter,
  WildRouletteCorner,
} from "./wild-glyph"
import {
  WildCardsCenter,
  WildDrawCorner,
  WildReverseDrawCenter,
} from "./wild-cards-glyph"
import { DiscardCenter, DiscardCorner } from "./discard-glyph"

/** Center symbol for any card face. */
export function GlyphCenter({ face }: { face: CardFace }) {
  switch (face.kind) {
    case "number":
      return <NumberCenter value={face.value} />
    case "skip":
      return <SkipCenter />
    case "skip-everyone":
      return <SkipEveryoneCenter />
    case "reverse":
      return <ReverseCenter />
    case "draw":
      return <DrawCenter count={face.count} />
    case "discard-color":
      return <DiscardCenter />
    case "wild":
      return <WildCenter />
    case "wild-color-roulette":
      return <WildRouletteCenter />
    case "wild-draw":
      return <WildCardsCenter count={face.count} />
    case "wild-reverse-draw":
      return <WildReverseDrawCenter count={face.count} />
    default: {
      const _exhaustive: never = face
      return _exhaustive
    }
  }
}

/** Corner symbol — the small marker at top-left and bottom-right. */
export function GlyphCorner({ face }: { face: CardFace }) {
  switch (face.kind) {
    case "number":
      return <NumberCorner value={face.value} />
    case "skip":
      return <SkipCorner />
    case "skip-everyone":
      return <SkipCorner />
    case "reverse":
      return <ReverseCorner />
    case "draw":
      return <DrawCorner count={face.count} />
    case "discard-color":
      return <DiscardCorner />
    case "wild":
      return <WildCorner />
    case "wild-color-roulette":
      return <WildRouletteCorner />
    case "wild-draw":
      return <WildDrawCorner count={face.count} />
    case "wild-reverse-draw":
      return <WildDrawCorner count={face.count} />
    default: {
      const _exhaustive: never = face
      return _exhaustive
    }
  }
}

/**
 * Picks the oval treatment for each face:
 * - "color-ring": colored cards get a black ring with the colored body showing through
 * - "white-only": wild cards get a smaller white oval inside the black body
 * - "hidden":     reserved for graphics that need the full card body
 */
export function ovalModeFor(_face: CardFace, color: CardColor): OvalMode {
  if (color === "wild") return "white-only"
  return "color-ring"
}
