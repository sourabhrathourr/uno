import type { ReactNode } from 'react';
import { View } from 'react-native';

type Position = 'top-left' | 'bottom-right';

type Props = {
  position: Position;
  inset: number;
  children: ReactNode;
};

/**
 * Corner pip. Symbols are rendered upright at top-left and rotated 180° at
 * bottom-right so the card stays readable when held by the player across the
 * table. The center oval keeps its tilt independently. The glyph sizes itself
 * via its own `fontPx` prop; the wrapper just positions and rotates.
 */
export function CardCorner({ position, inset, children }: Props) {
  const isBottom = position === 'bottom-right';
  return (
    <View
      pointerEvents="none"
      style={[
        // Shrink-wrap to the glyph so wide labels like "+10" don't get
        // clipped by a fixed-width parent. The column still centers stacked
        // children (e.g. NumberCorner's swap-arrows pip under the digit).
        { position: 'absolute', alignItems: 'center' },
        isBottom
          ? { right: inset, bottom: inset, transform: [{ rotate: '180deg' }] }
          : { left: inset, top: inset },
      ]}
    >
      {children}
    </View>
  );
}
