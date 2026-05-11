import { palette, tiltDegrees } from "../tokens"

/**
 * Back of every card. The black metallic body is supplied by CardSurface;
 * here we paint the iconic red oval and the upright "UNO" wordmark.
 */
export function CardBack() {
  const red = palette.red
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 100 140"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <radialGradient id="back-oval-grad" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stopColor={red.light} />
            <stop offset="60%" stopColor={red.base} />
            <stop offset="100%" stopColor={red.deep} />
          </radialGradient>
        </defs>
        <g transform={`rotate(${tiltDegrees} 50 70)`}>
          <ellipse cx="50" cy="70" rx="42" ry="68" fill="black" />
          <ellipse cx="50" cy="70" rx="38" ry="62" fill="url(#back-oval-grad)" />
        </g>
        {/* "UNO" upright — sits on top of the tilted red oval. */}
        <text
          x="50"
          y="78"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="32"
          fontWeight="900"
          fontStyle="italic"
          fill="white"
          stroke="black"
          strokeWidth="3.5"
          strokeLinejoin="round"
          paintOrder="stroke fill"
          fontFamily="Geist Variable, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
          letterSpacing="-1.5"
        >
          UNO
        </text>
      </svg>
    </div>
  )
}
