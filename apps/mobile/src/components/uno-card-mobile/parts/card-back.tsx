import { paletteRgb, tiltDegrees } from '@workspace/uno-card-tokens';
import { StyleSheet, View } from 'react-native';
import {
  Defs,
  Ellipse,
  G,
  LinearGradient,
  RadialGradient,
  Stop,
  Svg,
} from 'react-native-svg';

import {
  glyphFontFamily,
  glyphFontWeight,
  OutlinedSvgText,
} from '@/components/uno-card-mobile/glyphs/glyph-shared';

/**
 * Back of every card. The black metallic body is supplied by `CardSurface`;
 * here we paint the iconic red oval and the upright "UNO" wordmark.
 */
export function CardBack() {
  const red = paletteRgb.red;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg
        viewBox="0 0 100 140"
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
      >
        <Defs>
          <RadialGradient
            id="back-oval-grad"
            cx="40%"
            cy="30%"
            rx="80%"
            ry="80%"
            fx="40%"
            fy="30%"
          >
            <Stop offset="0%" stopColor={red.light} />
            <Stop offset="60%" stopColor={red.base} />
            <Stop offset="100%" stopColor={red.deep} />
          </RadialGradient>
          {/* Unused but kept for parity if we want to tint the wordmark later. */}
          <LinearGradient id="back-uno-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#ffffff" />
            <Stop offset="100%" stopColor="#f4f4f5" />
          </LinearGradient>
        </Defs>
        <G transform={`rotate(${tiltDegrees} 50 70)`}>
          <Ellipse cx={50} cy={70} rx={42} ry={68} fill="black" />
          <Ellipse cx={50} cy={70} rx={38} ry={62} fill="url(#back-oval-grad)" />
        </G>
        <OutlinedSvgText
          x={47.5}
          y={78}
          textAnchor="middle"
          alignmentBaseline="middle"
          fontSize={32}
          fontFamily={glyphFontFamily}
          fontWeight={glyphFontWeight}
          fontStyle="italic"
          strokeWidth={3.5}
        >
          UNO
        </OutlinedSvgText>
      </Svg>
    </View>
  );
}
