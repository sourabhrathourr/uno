import { tiltDegrees } from '@workspace/uno-card-tokens';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Defs,
  Ellipse,
  G,
  RadialGradient,
  Stop,
  Svg,
} from 'react-native-svg';

export type OvalMode =
  | 'color-ring' // black ring + colored body inside (colored cards)
  | 'white-only' // smaller plain white oval (wild cards)
  | 'hidden'; //    graphic dominates the whole face

type Props = {
  mode: OvalMode;
  children: ReactNode;
};

/**
 * The signature UNO ellipse plus the upright glyph.
 *
 * - The oval(s) are drawn into the SVG and rotated by `tiltDegrees` via a
 *   transform on a `<G>` — this keeps the iconic tilt without rotating the
 *   glyph that sits on top.
 * - The glyph is rendered into a separate centered layer so numbers and
 *   action symbols read upright (per the No Mercy print).
 * - "color-ring" draws a black ellipse stroke so the colored body shows
 *   through inside it; "white-only" paints a smaller white oval.
 */
export function CardCenter({ mode, children }: Props) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {mode !== 'hidden' && (
        <Svg
          viewBox="0 0 100 140"
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
        >
          <Defs>
            <RadialGradient
              id="oval-shade"
              cx="40%"
              cy="30%"
              rx="80%"
              ry="80%"
              fx="40%"
              fy="30%"
            >
              <Stop offset="0%" stopColor="white" stopOpacity={0} />
              <Stop offset="80%" stopColor="black" stopOpacity={0.04} />
              <Stop offset="100%" stopColor="black" stopOpacity={0.12} />
            </RadialGradient>
          </Defs>

          <G transform={`rotate(${tiltDegrees} 50 70)`}>
            {mode === 'color-ring' && (
              <Ellipse
                cx={50}
                cy={70}
                rx={41}
                ry={69}
                fill="none"
                stroke="black"
                strokeWidth={5.5}
              />
            )}
            {mode === 'white-only' && (
              <>
                <Ellipse cx={50} cy={70} rx={30} ry={48} fill="white" />
                <Ellipse
                  cx={50}
                  cy={70}
                  rx={30}
                  ry={48}
                  fill="url(#oval-shade)"
                  opacity={0.4}
                />
              </>
            )}
          </G>
        </Svg>
      )}
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <View
          style={{
            width: '76%',
            height: '76%',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
