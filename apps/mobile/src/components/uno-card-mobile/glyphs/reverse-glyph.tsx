import { G, Path, Svg } from 'react-native-svg';

import { GlyphCanvas } from '@/components/uno-card-mobile/glyphs/glyph-shared';

/**
 * Two thick arrows pointing opposite directions — UNO's reverse mark.
 * Stacked black-then-white the same way Skip is, for the chunky outline.
 */
function ReverseMark({
  cx,
  cy,
  scale,
}: {
  cx: number;
  cy: number;
  scale: number;
}) {
  return (
    <G transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <G transform="translate(0 -10)">
        <Path
          d="M -22 -6 L 8 -6 L 8 -16 L 26 -2 L 8 12 L 8 2 L -22 2 Z"
          fill="white"
          stroke="black"
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </G>
      <G transform="translate(0 10)">
        <Path
          d="M 22 6 L -8 6 L -8 16 L -26 2 L -8 -12 L -8 -2 L 22 -2 Z"
          fill="white"
          stroke="black"
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </G>
    </G>
  );
}

export function ReverseCenter() {
  return (
    <GlyphCanvas>
      <ReverseMark cx={50} cy={70} scale={1.5} />
    </GlyphCanvas>
  );
}

export function ReverseCorner({ fontPx }: { fontPx: number }) {
  const size = fontPx * 1.2;
  return (
    <Svg width={size} height={size} viewBox="-26 -26 52 52">
      <ReverseMark cx={0} cy={0} scale={0.65} />
    </Svg>
  );
}
