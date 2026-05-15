import { G, Path, Rect, Svg } from 'react-native-svg';

import { GlyphCanvas } from '@/components/uno-card-mobile/glyphs/glyph-shared';

function MiniFan({ count }: { count: number }) {
  return (
    <G>
      {Array.from({ length: count }).map((_, i) => {
        const offset = (i - (count - 1) / 2) * 3.5;
        const tilt = (i - (count - 1) / 2) * 7;
        return (
          <G
            key={i}
            transform={`translate(${offset} 0) rotate(${tilt})`}
          >
            <Rect
              x={-7}
              y={-10}
              width={14}
              height={20}
              rx={2}
              fill="white"
              stroke="black"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </G>
        );
      })}
    </G>
  );
}

function MiniStack() {
  return (
    <G>
      {[0, 1, 2].map((i) => (
        <Rect
          key={i}
          x={-9 - i}
          y={-12 - i}
          width={18}
          height={24}
          rx={2}
          fill="white"
          stroke="black"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ))}
    </G>
  );
}

function ArrowMark({
  x,
  y,
  rotate,
}: {
  x: number;
  y: number;
  rotate: number;
}) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <Path
        d="M -8 0 L 4 -5 L 4 -1.5 L 10 -1.5 L 10 1.5 L 4 1.5 L 4 5 Z"
        fill="white"
        stroke="black"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </G>
  );
}

/**
 * Discard-Color center: a hand of cards above a face-down deck, with a single
 * arrow showing cards being thrown out of the hand into the pile.
 */
export function DiscardCenter() {
  return (
    <GlyphCanvas>
      <G transform="translate(50 54) rotate(6)">
        <MiniFan count={5} />
      </G>
      <ArrowMark x={50} y={76} rotate={90} />
      <G transform="translate(50 96)">
        <MiniStack />
      </G>
    </GlyphCanvas>
  );
}

export function DiscardCorner({ fontPx }: { fontPx: number }) {
  const size = fontPx;
  return (
    <Svg width={size} height={size} viewBox="-14 -14 28 28">
      <G transform="rotate(-15)">
        <MiniFan count={3} />
      </G>
      <ArrowMark x={10} y={-7} rotate={-20} />
    </Svg>
  );
}
