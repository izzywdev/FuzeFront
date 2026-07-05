import React from "react";

const SIZES = {
  sm: { font: "var(--text-base)", logo: 20, gap: "var(--space-2)" },
  md: { font: "var(--text-lg)", logo: 28, gap: "var(--space-2)" },
  lg: { font: "var(--text-2xl)", logo: 36, gap: "var(--space-3)" },
};

/**
 * The FuzeFront wordmark: "Fuze" filled with the runtime --seam gradient,
 * "Front" in solid --text-primary, set in the display face with tight tracking.
 * Optional logo image sits to the left of the wordmark.
 */
export function BrandMark({
  size = "md",
  logo,
  alt = "FuzeFront",
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-bold)",
        fontSize: s.font,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: "var(--text-primary)",
        whiteSpace: "nowrap",
        userSelect: "none",
        ...style,
      }}
      {...rest}
    >
      {logo && (
        <img
          src={logo}
          alt={alt}
          style={{ height: s.logo, width: "auto", display: "block", flex: "none" }}
        />
      )}
      <span>
        <span
          style={{
            background: "var(--seam)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "transparent",
          }}
        >
          Fuze
        </span>
        Front
      </span>
    </span>
  );
}
