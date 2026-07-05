import React from "react";

const SIZES = {
  sm: { padding: "1px 7px", font: "var(--text-2xs)", gap: "4px", icon: 11 },
  md: { padding: "2px 9px", font: "var(--text-xs)", gap: "5px", icon: 13 },
};

// Each tone reads as the status/accent color set as text on a faint wash
// of that same hue, so badges stay legible on the dark shell.
const TONES = {
  neutral: {
    color: "var(--text-secondary)",
    background: "var(--bg-quaternary)",
    border: "1px solid var(--border-color)",
  },
  accent: {
    color: "var(--accent-color)",
    background: "var(--accent-soft)",
    border: "1px solid transparent",
  },
  success: {
    color: "var(--success-color)",
    background: "color-mix(in srgb, var(--success-color) 14%, transparent)",
    border: "1px solid transparent",
  },
  warning: {
    color: "var(--warning-color)",
    background: "color-mix(in srgb, var(--warning-color) 14%, transparent)",
    border: "1px solid transparent",
  },
  error: {
    color: "var(--error-color)",
    background: "color-mix(in srgb, var(--error-color) 14%, transparent)",
    border: "1px solid transparent",
  },
};

const Dot = ({ size = 6 }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor"
    style={{ flex: "none" }} aria-hidden="true">
    <circle cx="5" cy="5" r="5" />
  </svg>
);

/**
 * Small pill label. Tones map to the accent "fuse" or the status set;
 * the `mono` flag switches to JetBrains Mono for technical values
 * (app types, scopes, role keys). Mirrors .app-type-badge / RoleBadge.
 */
export function Badge({
  children,
  tone = "neutral",
  size = "md",
  mono = false,
  dot = false,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        padding: s.padding,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: s.font,
        fontWeight: "var(--weight-medium)",
        letterSpacing: mono ? "var(--tracking-normal)" : "var(--tracking-wide)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        borderRadius: "var(--radius-pill)",
        textTransform: mono ? "none" : "uppercase",
        ...t,
        ...style,
      }}
      {...rest}
    >
      {dot && <Dot size={size === "sm" ? 5 : 6} />}
      {children}
    </span>
  );
}
