import React, { forwardRef } from "react";
import { Container } from "./Container.jsx";

// ds-fp:bda2530cf822 — extracted per issue #938. The dark marketing-site
// hero wrapper (diagonal gradient + dot-grid overlay + one or two blurred
// accent blobs, pinned to a fixed pt-32/pb-20 rhythm) was hand-duplicated,
// pixel-for-pixel, across AboutPage/CareersPage/PressPage. One primitive
// owns the look; callers only vary the two dynamic things that differed
// across call sites — the children, and which corner blob(s) to show.
//
// Implemented with inline styles + component-scoped constants (no Tailwind
// utility classes) so it matches every other DS primitive and is portable
// to any consuming app regardless of that app's own Tailwind config — the
// DS package is the one place these "tokens only" raw values are allowed
// to live (design-system-conformance skill, "DS package itself excluded").
const GRADIENT = {
  from: "#0f172a", // secondary-900 — near-black slate
  via: "#1e293b", // secondary-800
  to: "#1e3a8a", // primary-900
};

// Same dot-grid the marketing site's global `.hero-pattern` class drew —
// centralized here instead of depending on that app-global CSS class.
const DOT_PATTERN =
  "radial-gradient(circle at 1px 1px, rgba(59, 130, 246, 0.1) 1px, transparent 0)";

const BLOB_TONE = {
  primary: "rgba(37, 99, 235, 0.2)", // primary-600 @ 20%
  accent: "rgba(192, 38, 211, 0.15)", // accent-600 @ 15%
};

const BLOB_SIZE = {
  md: "288px", // w-72 h-72
  lg: "320px", // w-80 h-80
};

const BLOB_CORNER = {
  "top-left": { top: "40px", left: "25%" },
  "top-right": { top: "40px", right: "25%" },
  "bottom-left": { bottom: 0, left: "25%" },
  "bottom-right": { bottom: 0, right: "25%" },
};

/**
 * HeroSection — the dark gradient hero band used at the top of marketing
 * pages: diagonal slate→indigo gradient, a subtle dot-grid overlay, and
 * zero or more soft blurred accent blobs pinned to a corner, all centered
 * inside the standard `Container`.
 *
 * `decor` lists the blobs to render (`{ corner, tone, size }`, 0–2 of
 * them) — this is the only thing that varied visually across the three
 * recurring call sites (About: two blobs; Careers: one; Press: one, mirrored).
 *
 * Forwards `ref` to the rendered element so callers can still wire it into
 * `useInView`/`useRef` for their own enter-animation, exactly as every
 * call site already did with a plain `<section ref={heroRef}>`.
 *
 * `pattern={false}` drops the dot-grid overlay; `gradient` can override the
 * three gradient stops for a page that wants a different hero tone while
 * keeping the rest of the shape.
 */
export const HeroSection = forwardRef(function HeroSection(
  {
    as: As = "section",
    children,
    containerSize = "4xl",
    align = "center",
    decor = [],
    pattern = true,
    gradient = GRADIENT,
    className,
    style,
    ...rest
  },
  ref
) {
  return (
    <As
      ref={ref}
      className={className}
      style={{
        position: "relative",
        paddingTop: "8rem",
        paddingBottom: "5rem",
        overflow: "hidden",
        backgroundImage: `linear-gradient(to bottom right, ${gradient.from}, ${gradient.via}, ${gradient.to})`,
        ...style,
      }}
      {...rest}
    >
      {pattern && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: DOT_PATTERN,
            backgroundSize: "20px 20px",
          }}
        />
      )}
      {decor.map((blob, i) => {
        const size = BLOB_SIZE[blob.size] || BLOB_SIZE.lg;
        const corner = BLOB_CORNER[blob.corner] || BLOB_CORNER["top-left"];
        return (
          <div
            key={i}
            aria-hidden="true"
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "9999px",
              background: BLOB_TONE[blob.tone] || BLOB_TONE.primary,
              filter: "blur(64px)",
              pointerEvents: "none",
              ...corner,
            }}
          />
        );
      })}
      <Container size={containerSize} style={{ position: "relative", textAlign: align }}>
        {children}
      </Container>
    </As>
  );
});

HeroSection.displayName = "HeroSection";
