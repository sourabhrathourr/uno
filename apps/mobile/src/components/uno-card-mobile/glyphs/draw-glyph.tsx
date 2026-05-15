import { G, Rect, Svg } from 'react-native-svg';

import {
  GlyphCanvas,
  glyphFontFamily,
  glyphFontWeight,
  OutlinedSvgText,
} from '@/components/uno-card-mobile/glyphs/glyph-shared';

/** A small white card silhouette with chunky black outline. */
function MiniCard({
  x,
  y,
  rotate,
  w = 28,
  h = 38,
}: {
  x: number;
  y: number;
  rotate: number;
  w?: number;
  h?: number;
}) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={3}
        fill="white"
        stroke="black"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </G>
  );
}

/**
 * Center for colored Draw-N cards: a fan of mini-cards. `count` of them spread
 * evenly — visually communicates "you are taking N cards".
 */
export function DrawCenter({ count }: { count: 2 | 4 }) {
  const layouts: Record<2 | 4, { x: number; y: number; rotate: number }[]> = {
    2: [
      { x: 38, y: 70, rotate: -10 },
      { x: 62, y: 70, rotate: 10 },
    ],
    4: [
      { x: 32, y: 74, rotate: -22 },
      { x: 44, y: 66, rotate: -8 },
      { x: 58, y: 66, rotate: 8 },
      { x: 70, y: 74, rotate: 22 },
    ],
  };
  return (
    <GlyphCanvas>
      {layouts[count].map((slot, i) => (
        <MiniCard key={i} {...slot} />
      ))}
    </GlyphCanvas>
  );
}

export function DrawCorner({
  count,
  fontPx,
}: {
  count: number;
  fontPx: number;
}) {
  const label = `+${count}`;
  // Scale the canvas with the label length so 3-char labels stay inside.
  const w = fontPx * (0.5 + label.length * 0.55);
  const h = fontPx;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <OutlinedSvgText
        x={w / 2}
        y={h / 2}
        textAnchor="middle"
        alignmentBaseline="middle"
        fontSize={fontPx}
        fontFamily={glyphFontFamily}
        fontWeight={glyphFontWeight}
        strokeWidth={fontPx * 0.16}
      >
        {label}
      </OutlinedSvgText>
    </Svg>
  );
}
