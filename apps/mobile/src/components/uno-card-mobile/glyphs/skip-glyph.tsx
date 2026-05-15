import { Circle, Line, Svg } from 'react-native-svg';

import { GlyphCanvas } from '@/components/uno-card-mobile/glyphs/glyph-shared';

/**
 * The no-entry sign. Two stacked strokes — black under, white over — so the
 * white reads cleanly while keeping a thick outline.
 */
function SkipMark({
  cx,
  cy,
  r,
  outerWidth,
  innerWidth,
}: {
  cx: number;
  cy: number;
  r: number;
  outerWidth: number;
  innerWidth: number;
}) {
  const slashOffset = r * 0.74;
  return (
    <>
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="black"
        strokeWidth={outerWidth}
      />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="white"
        strokeWidth={innerWidth}
      />
      <Line
        x1={cx - slashOffset}
        y1={cy - slashOffset}
        x2={cx + slashOffset}
        y2={cy + slashOffset}
        stroke="black"
        strokeWidth={outerWidth}
        strokeLinecap="round"
      />
      <Line
        x1={cx - slashOffset}
        y1={cy - slashOffset}
        x2={cx + slashOffset}
        y2={cy + slashOffset}
        stroke="white"
        strokeWidth={innerWidth}
        strokeLinecap="round"
      />
    </>
  );
}

export function SkipCenter() {
  return (
    <GlyphCanvas>
      <SkipMark cx={50} cy={70} r={30} outerWidth={14} innerWidth={9} />
    </GlyphCanvas>
  );
}

export function SkipEveryoneCenter() {
  return (
    <GlyphCanvas>
      <SkipMark cx={34} cy={62} r={18} outerWidth={9} innerWidth={5.5} />
      <SkipMark cx={66} cy={62} r={18} outerWidth={9} innerWidth={5.5} />
      <SkipMark cx={50} cy={92} r={18} outerWidth={9} innerWidth={5.5} />
    </GlyphCanvas>
  );
}

export function SkipCorner({ fontPx }: { fontPx: number }) {
  return (
    <Svg width={fontPx} height={fontPx} viewBox="0 0 24 24">
      <SkipMark cx={12} cy={12} r={9} outerWidth={4.5} innerWidth={2.5} />
    </Svg>
  );
}
