import {
  DiscardCenter,
  DiscardCorner,
} from '@/components/uno-card-mobile/glyphs/discard-glyph';
import {
  DrawCenter,
  DrawCorner,
} from '@/components/uno-card-mobile/glyphs/draw-glyph';
import {
  NumberCenter,
  NumberCorner,
} from '@/components/uno-card-mobile/glyphs/number-glyph';
import {
  ReverseCenter,
  ReverseCorner,
} from '@/components/uno-card-mobile/glyphs/reverse-glyph';
import {
  SkipCenter,
  SkipCorner,
  SkipEveryoneCenter,
} from '@/components/uno-card-mobile/glyphs/skip-glyph';
import {
  WildCardsCenter,
  WildDrawCorner,
  WildReverseDrawCenter,
} from '@/components/uno-card-mobile/glyphs/wild-cards-glyph';
import {
  WildCenter,
  WildCorner,
  WildRouletteCenter,
  WildRouletteCorner,
} from '@/components/uno-card-mobile/glyphs/wild-glyph';
import type { OvalMode } from '@/components/uno-card-mobile/parts/card-center';
import type {
  CardColor,
  CardFace,
} from '@/components/uno-card-mobile/types';

/** Center symbol for any card face. */
export function GlyphCenter({ face }: { face: CardFace }) {
  switch (face.kind) {
    case 'number':
      return <NumberCenter value={face.value} />;
    case 'skip':
      return <SkipCenter />;
    case 'skip-everyone':
      return <SkipEveryoneCenter />;
    case 'reverse':
      return <ReverseCenter />;
    case 'draw':
      return <DrawCenter count={face.count} />;
    case 'discard-color':
      return <DiscardCenter />;
    case 'wild':
      return <WildCenter />;
    case 'wild-color-roulette':
      return <WildRouletteCenter />;
    case 'wild-draw':
      return <WildCardsCenter count={face.count} />;
    case 'wild-reverse-draw':
      return <WildReverseDrawCenter count={face.count} />;
    default: {
      const _exhaustive: never = face;
      return _exhaustive;
    }
  }
}

/** Corner symbol — the small marker at top-left and bottom-right. */
export function GlyphCorner({
  face,
  fontPx,
}: {
  face: CardFace;
  fontPx: number;
}) {
  switch (face.kind) {
    case 'number':
      return <NumberCorner value={face.value} fontPx={fontPx} />;
    case 'skip':
      return <SkipCorner fontPx={fontPx} />;
    case 'skip-everyone':
      return <SkipCorner fontPx={fontPx} />;
    case 'reverse':
      return <ReverseCorner fontPx={fontPx} />;
    case 'draw':
      return <DrawCorner count={face.count} fontPx={fontPx} />;
    case 'discard-color':
      return <DiscardCorner fontPx={fontPx} />;
    case 'wild':
      return <WildCorner fontPx={fontPx} />;
    case 'wild-color-roulette':
      return <WildRouletteCorner fontPx={fontPx} />;
    case 'wild-draw':
      return <WildDrawCorner count={face.count} fontPx={fontPx} />;
    case 'wild-reverse-draw':
      return <WildDrawCorner count={face.count} fontPx={fontPx} />;
    default: {
      const _exhaustive: never = face;
      return _exhaustive;
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
  if (color === 'wild') return 'white-only';
  return 'color-ring';
}
