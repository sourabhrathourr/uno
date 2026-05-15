import type { ReactNode } from 'react';
import {
  Svg,
  Text as SvgText,
  type TextProps as SvgTextProps,
} from 'react-native-svg';

/**
 * Shared SVG canvas for center glyphs. Every glyph draws into this 100×140
 * viewBox so the strokes stay proportional to the card.
 */
export function GlyphCanvas({ children }: { children: ReactNode }) {
  return (
    <Svg
      viewBox="0 0 100 140"
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
    >
      {children}
    </Svg>
  );
}

/**
 * The UNO white-on-color outlined-text look — a thick black stroke painted
 * UNDER a white fill. On the web a single element with `paint-order: stroke fill`
 * does this; react-native-svg doesn't honor paint-order across platforms, so
 * we draw the text twice — stroke first, fill on top.
 */
export function OutlinedSvgText({
  children,
  strokeWidth,
  outlineColor = 'black',
  fill = 'white',
  ...rest
}: SvgTextProps & {
  children: ReactNode;
  strokeWidth: number;
  outlineColor?: string;
}) {
  return (
    <>
      <SvgText
        {...rest}
        fill={outlineColor}
        stroke={outlineColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {children}
      </SvgText>
      <SvgText {...rest} fill={fill} stroke="none">
        {children}
      </SvgText>
    </>
  );
}

/** Geist isn't bundled in the native app; system bold matches the heft closely enough. */
export const glyphFontFamily = 'System';
export const glyphFontWeight = '900' as const;
