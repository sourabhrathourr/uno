import { paletteRgb } from '@workspace/uno-card-tokens';
import { Ellipse, G, Path, Svg } from 'react-native-svg';

import { GlyphCanvas } from '@/components/uno-card-mobile/glyphs/glyph-shared';

/**
 * Four colored splotches arranged like a clover — UNO's wild signature.
 * Each splotch is a mini ellipse echoing the central white oval.
 */
function WildClover({
  cx,
  cy,
  scale,
}: {
  cx: number;
  cy: number;
  scale: number;
}) {
  const splotches: {
    dx: number;
    dy: number;
    color: keyof typeof paletteRgb;
  }[] = [
    { dx: 0, dy: -16, color: 'red' },
    { dx: 16, dy: 0, color: 'blue' },
    { dx: 0, dy: 16, color: 'green' },
    { dx: -16, dy: 0, color: 'yellow' },
  ];
  return (
    <G transform={`translate(${cx} ${cy}) scale(${scale})`}>
      {splotches.map((s) => (
        <G key={s.color} transform={`translate(${s.dx} ${s.dy})`}>
          <Ellipse
            rx={14}
            ry={11}
            fill={paletteRgb[s.color].base}
            stroke="black"
            strokeWidth={3}
          />
          {/* tiny inner highlight to keep them from looking flat */}
          <Ellipse
            rx={14}
            ry={11}
            fill={paletteRgb[s.color].light}
            opacity={0.45}
            transform="translate(-3 -3) scale(0.7)"
          />
        </G>
      ))}
    </G>
  );
}

export function WildCenter() {
  return (
    <GlyphCanvas>
      <WildClover cx={50} cy={70} scale={1.5} />
    </GlyphCanvas>
  );
}

export function WildCorner({ fontPx }: { fontPx: number }) {
  const size = fontPx * 1.4;
  return (
    <Svg width={size} height={size} viewBox="-30 -30 60 60">
      <WildClover cx={0} cy={0} scale={0.85} />
    </Svg>
  );
}

export function WildRouletteCenter() {
  return (
    <GlyphCanvas>
      <WildClover cx={50} cy={58} scale={1.15} />
      <Path
        d="M 30 98 A 26 26 0 0 0 76 86"
        fill="none"
        stroke="black"
        strokeWidth={12}
        strokeLinecap="round"
      />
      <Path
        d="M 30 98 A 26 26 0 0 0 76 86"
        fill="none"
        stroke="white"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <Path
        d="M 74 73 L 87 88 L 68 92 Z"
        fill="white"
        stroke="black"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </GlyphCanvas>
  );
}

export function WildRouletteCorner({ fontPx }: { fontPx: number }) {
  const size = fontPx * 1.4;
  return (
    <Svg width={size} height={size} viewBox="-30 -30 60 60">
      <WildClover cx={0} cy={-4} scale={0.55} />
      <Path
        d="M -16 17 A 20 20 0 0 0 18 10"
        fill="none"
        stroke="black"
        strokeWidth={9}
        strokeLinecap="round"
      />
      <Path
        d="M -16 17 A 20 20 0 0 0 18 10"
        fill="none"
        stroke="white"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <Path
        d="M 17 -2 L 27 11 L 11 14 Z"
        fill="white"
        stroke="black"
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
