import React from "react";

/**
 * Absolutely-positioned dot-grid texture laid over a hero/band section,
 * dialed down with `opacity` so it reads as a quiet background texture
 * rather than a pattern. Replaces the repeated
 * `className="absolute inset-0 hero-pattern opacity-NN"` markup that
 * recurred across the marketing site's hero sections (one shared
 * `.hero-pattern` CSS class plus a different Tailwind opacity utility
 * at every call site).
 *
 * Purely decorative: renders `aria-hidden` and `pointer-events: none` so
 * it never intercepts clicks or gets announced to assistive tech, and is
 * safe to stack under real content via a `position: relative` ancestor.
 */
export function HeroPatternOverlay({ opacity = 0.1, style, ...rest }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage:
          "radial-gradient(circle at 1px 1px, var(--accent-color) 1px, transparent 0)",
        backgroundSize: "20px 20px",
        ...style,
      }}
      {...rest}
    />
  );
}
