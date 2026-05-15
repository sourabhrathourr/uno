import { paletteRgb } from '@workspace/uno-card-tokens';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Defs,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
  Svg,
} from 'react-native-svg';

import type { CardColor } from '@/components/uno-card-mobile/types';

type Props = {
  color: CardColor;
  width: number;
  height: number;
  radius: number;
  children?: ReactNode;
};

/**
 * The metallic colored body that sits inside the card frame.
 *
 * Builds the anodized look from layered SVG fills inside a single clipped
 * `<View>`, mirroring the web component which stacks CSS background-images.
 *
 * Read the layers as the journey light makes across the surface:
 *   1. Anodized diagonal sweep   (deep → base → mid → light → mid → base → deep)
 *   2. Brushed-metal streaks     (subtle vertical pattern, ~4% opacity)
 *   3. Specular sheen catch      (soft ellipse near upper-left)
 *   4. Top gloss highlight       (thin gradient hugging the top edge)
 *   5. Bottom-right shadow plate (radial shading toward the lower-right)
 *   6. Bevel rim                 (1px stroke with light→dark gradient)
 */
export function CardSurface({
  color,
  width,
  height,
  radius,
  children,
}: Props) {
  const ramp = paletteRgb[color];
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: ramp.base,
      }}
    >
      <Svg
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient
            id="anodized"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <Stop offset="0%" stopColor={ramp.deep} />
            <Stop offset="22%" stopColor={ramp.base} />
            <Stop offset="48%" stopColor={ramp.mid} />
            <Stop offset="60%" stopColor={ramp.light} />
            <Stop offset="74%" stopColor={ramp.mid} />
            <Stop offset="88%" stopColor={ramp.base} />
            <Stop offset="100%" stopColor={ramp.deep} />
          </LinearGradient>

          <RadialGradient
            id="sheen"
            cx="22%"
            cy="14%"
            rx="70%"
            ry="55%"
            fx="22%"
            fy="14%"
          >
            <Stop offset="0%" stopColor={ramp.sheen} stopOpacity={0.45} />
            <Stop offset="60%" stopColor={ramp.sheen} stopOpacity={0} />
          </RadialGradient>

          <Pattern
            id="brushed"
            patternUnits="userSpaceOnUse"
            width={3}
            height={3}
            patternTransform="rotate(2)"
          >
            <Rect
              width={2}
              height={3}
              fill={ramp.sheen}
              fillOpacity={0.05}
            />
          </Pattern>

          <LinearGradient
            id="topGloss"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <Stop
              offset="0%"
              stopColor={ramp.sheen}
              stopOpacity={0.18}
            />
            <Stop offset="70%" stopColor={ramp.sheen} stopOpacity={0} />
          </LinearGradient>

          <RadialGradient
            id="bottomShadow"
            cx="100%"
            cy="100%"
            rx="90%"
            ry="70%"
            fx="100%"
            fy="100%"
          >
            <Stop offset="0%" stopColor={ramp.deep} stopOpacity={0.45} />
            <Stop offset="55%" stopColor={ramp.deep} stopOpacity={0} />
          </RadialGradient>

          <LinearGradient id="bevel" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
            <Stop offset="35%" stopColor="#ffffff" stopOpacity={0.08} />
            <Stop offset="65%" stopColor="#000000" stopOpacity={0.18} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0.6} />
          </LinearGradient>
        </Defs>

        <Rect width={width} height={height} fill="url(#anodized)" />
        <Rect width={width} height={height} fill="url(#brushed)" />
        <Rect width={width} height={height} fill="url(#sheen)" />
        <Rect
          x={0}
          y={0}
          width={width}
          height={height / 3}
          fill="url(#topGloss)"
        />
        <Rect width={width} height={height} fill="url(#bottomShadow)" />
        <Rect
          x={0.5}
          y={0.5}
          width={width - 1}
          height={height - 1}
          rx={Math.max(0, radius - 0.5)}
          ry={Math.max(0, radius - 0.5)}
          fill="none"
          stroke="url(#bevel)"
          strokeWidth={1}
        />
      </Svg>
      {children}
    </View>
  );
}
