import React from "react";

/**
 * Pill-shaped eyebrow label placed above section headings.
 * Renders a small accent dot on the left when `pulse` is true (default).
 */
export function Eyebrow({ children, pulse = true, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        background: "var(--accent-soft)",
        border: "1px solid rgba(110,92,255,0.2)",
        borderRadius: "var(--radius-pill)",
        padding: "4px 12px",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "var(--tracking-wide)",
        textTransform: "uppercase",
        color: "var(--accent-color)",
        width: "fit-content",
        ...style,
      }}
      {...rest}
    >
      {pulse && (
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--accent-color)",
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}
