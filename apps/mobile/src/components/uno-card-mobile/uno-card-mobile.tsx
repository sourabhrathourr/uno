import { sizes } from '@workspace/uno-card-tokens';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect } from 'react';
import {
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  GlyphCenter,
  GlyphCorner,
  ovalModeFor,
} from '@/components/uno-card-mobile/glyphs';
import { CardBack } from '@/components/uno-card-mobile/parts/card-back';
import { CardCenter } from '@/components/uno-card-mobile/parts/card-center';
import { CardCorner } from '@/components/uno-card-mobile/parts/card-corner';
import { CardSurface } from '@/components/uno-card-mobile/parts/card-surface';
import type { Card, CardSize } from '@/components/uno-card-mobile/types';

type Props = {
  card: Card;
  size?: CardSize;
  /** Renders the back instead of the face. */
  faceDown?: boolean;
  /** Visually elevates the card — the "selected" / "playable" state. */
  raised?: boolean;
  /** Disable touch and dim the card. */
  disabled?: boolean;
  /** Disable the press scale — useful in static layouts. */
  static?: boolean;
  /** Skip the light haptic tap on press. */
  noHaptics?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * The foundation card on mobile. Composes a metallic colored body with a
 * tilted oval and an upright glyph + corner pips — drawn entirely with
 * `react-native-svg` so the look matches the web component pixel-for-pixel.
 *
 * Interaction: a single `Pressable` drives press / release animations through
 * Reanimated 4 shared values; the elevated `raised` prop layers on top so a
 * card can be "selected" while still feeling the press shrink.
 */
export function UnoCardMobile({
  card,
  size = 'md',
  faceDown = false,
  raised = false,
  disabled = false,
  static: isStatic = false,
  noHaptics = false,
  style,
  onPress,
  accessibilityLabel,
}: Props) {
  const dim = sizes[size];
  const surfaceColor = faceDown ? 'wild' : card.color;
  const ovalMode = faceDown ? 'hidden' : ovalModeFor(card.face, card.color);

  const pressProgress = useSharedValue(0);
  const liftProgress = useSharedValue(raised ? 1 : 0);

  useEffect(() => {
    liftProgress.value = withTiming(raised ? 1 : 0, {
      duration: 180,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
  }, [raised, liftProgress]);

  const animatedStyle = useAnimatedStyle(() => {
    const press = pressProgress.value;
    const lift = liftProgress.value;
    // Press cancels the lift (matches web's `active:translateY(0)`).
    const translateY = lift * -8 * (1 - press);
    const scale = 1 - 0.04 * press;
    return {
      opacity: disabled ? 0.55 : 1,
      transform: [{ translateY }, { scale }],
    };
  }, [disabled]);

  const handlePressIn = useCallback(() => {
    if (isStatic || disabled) return;
    pressProgress.value = withTiming(1, {
      duration: 120,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
  }, [pressProgress, isStatic, disabled]);

  const handlePressOut = useCallback(() => {
    if (isStatic || disabled) return;
    pressProgress.value = withTiming(0, {
      duration: 180,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
  }, [pressProgress, isStatic, disabled]);

  const handlePress = useCallback(() => {
    if (!onPress || disabled) return;
    if (!noHaptics && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptics is best-effort; ignore failures (e.g. simulator).
      });
    }
    onPress();
  }, [onPress, disabled, noHaptics]);

  const label = accessibilityLabel ?? labelFor(card, faceDown);
  const isInteractive = Boolean(onPress) && !disabled;

  return (
    <Pressable
      accessibilityRole={isInteractive ? 'button' : 'image'}
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={isInteractive ? handlePress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.pressable, style]}
    >
      <Animated.View
        style={[
          styles.shadow,
          {
            width: dim.width,
            height: dim.height,
            borderRadius: dim.radius,
          },
          animatedStyle,
        ]}
      >
        <CardSurface
          color={surfaceColor}
          width={dim.width}
          height={dim.height}
          radius={dim.radius}
        >
          {faceDown ? (
            <CardBack />
          ) : (
            <>
              <CardCenter mode={ovalMode}>
                <View style={styles.glyphCenterSlot}>
                  <GlyphCenter face={card.face} />
                </View>
              </CardCenter>
              <CardCorner position="top-left" inset={dim.cornerInset}>
                <GlyphCorner face={card.face} fontPx={dim.cornerFontPx} />
              </CardCorner>
              <CardCorner position="bottom-right" inset={dim.cornerInset}>
                <GlyphCorner face={card.face} fontPx={dim.cornerFontPx} />
              </CardCorner>
            </>
          )}
        </CardSurface>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'flex-start',
  },
  shadow: {
    // Mirrors the web's three-layer drop shadow with the platform-native
    // primitives — iOS uses shadow*, Android uses elevation.
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 14,
      },
      android: {
        elevation: 6,
      },
      default: {
        // Used on Expo Web — closest to the web component's stacked shadows.
        boxShadow:
          '0 1px 1px rgba(0,0,0,0.18), 0 4px 8px -2px rgba(0,0,0,0.22), 0 14px 28px -10px rgba(0,0,0,0.34)',
      },
    }),
  },
  glyphCenterSlot: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function labelFor(card: Card, faceDown: boolean): string {
  if (faceDown) return 'Face-down UNO card';
  const color = card.color === 'wild' ? 'Wild' : capitalize(card.color);
  const face = card.face;
  switch (face.kind) {
    case 'number':
      return `${color} ${face.value}`;
    case 'skip':
      return `${color} Skip`;
    case 'skip-everyone':
      return `${color} Skip Everyone`;
    case 'reverse':
      return `${color} Reverse`;
    case 'draw':
      return `${color} Draw ${face.count}`;
    case 'discard-color':
      return `${color} Discard Color`;
    case 'wild':
      return 'Wild';
    case 'wild-draw':
      return `Wild Draw ${face.count}`;
    case 'wild-reverse-draw':
      return `Wild Reverse Draw ${face.count}`;
    case 'wild-color-roulette':
      return 'Wild Color Roulette';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
