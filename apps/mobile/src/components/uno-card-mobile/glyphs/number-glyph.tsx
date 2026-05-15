import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import {
  GlyphCanvas,
  glyphFontFamily,
  glyphFontWeight,
  OutlinedSvgText,
} from '@/components/uno-card-mobile/glyphs/glyph-shared';
import type { NumberValue } from '@/components/uno-card-mobile/types';

export function NumberCenter({ value }: { value: NumberValue }) {
  return (
    <GlyphCanvas>
      <OutlinedSvgText
        x={50}
        y={70}
        textAnchor="middle"
        alignmentBaseline="middle"
        fontSize={92}
        fontFamily={glyphFontFamily}
        fontWeight={glyphFontWeight}
        strokeWidth={9}
      >
        {String(value)}
      </OutlinedSvgText>
    </GlyphCanvas>
  );
}

export function NumberCorner({
  value,
  fontPx,
}: {
  value: NumberValue;
  fontPx: number;
}) {
  return (
    <View style={{ alignItems: 'center' }}>
      <CornerNumberSvg value={value} fontPx={fontPx} />
      {value === 7 && <SwapArrowsCorner fontPx={fontPx} />}
      {value === 0 && <RotateLoopCorner fontPx={fontPx} />}
    </View>
  );
}

function CornerNumberSvg({
  value,
  fontPx,
}: {
  value: NumberValue;
  fontPx: number;
}) {
  // Digit is at most one glyph wide for 0–9; reserve ~0.7em width.
  const w = fontPx * 0.7;
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
        {String(value)}
      </OutlinedSvgText>
    </Svg>
  );
}

/** Two arrows pointing outward — the No Mercy "swap hands" indicator under 7. */
function SwapArrowsCorner({ fontPx }: { fontPx: number }) {
  const w = fontPx * 1.1;
  const h = fontPx * 0.34;
  return (
    <Svg
      width={w}
      height={h}
      viewBox="-14 -4 28 8"
      style={{ marginTop: fontPx * 0.08 }}
    >
      <Path
        d="M -13 0 L -5 -3.5 L -5 -1 L 0 -1 L 0 1 L -5 1 L -5 3.5 Z"
        fill="white"
        stroke="black"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Path
        d="M 13 0 L 5 -3.5 L 5 -1 L 0 -1 L 0 1 L 5 1 L 5 3.5 Z"
        fill="white"
        stroke="black"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Curved arrow loop — the No Mercy "rotate hands" indicator under 0. */
function RotateLoopCorner({ fontPx }: { fontPx: number }) {
  const size = fontPx * 0.65;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="-9 -9 18 18"
      style={{ marginTop: fontPx * 0.08 }}
    >
      <Path
        d="M 0,-6 A 6,6 0 1,1 -1.5,5.8"
        fill="none"
        stroke="black"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Path
        d="M 0,-6 A 6,6 0 1,1 -1.5,5.8"
        fill="none"
        stroke="white"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <Path
        d="M -1.5,5.8 L -5,3 L 1,2 Z"
        fill="white"
        stroke="black"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
