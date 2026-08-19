import React from "react";

const SIZES = {
  sm: { dot: 8, ring: 1.5 },
  md: { dot: 12, ring: 2 },
  lg: { dot: 16, ring: 2.5 },
};

/**
 * Small round runtime-health indicator. Green when a remote is reachable,
 * coral when it's offline; a --bg-tertiary ring keeps it legible when it
 * overlaps an app icon in the launcher.
 */
export function HealthDot({
  healthy = true,
  size = "md",
  label,
  overlay = false,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const title =
    label || (healthy ? "Healthy — remote reachable" : "Offline — remote unreachable");
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      style={{
        display: "inline-block",
        width: s.dot,
        height: s.dot,
        borderRadius: "var(--radius-pill)",
        flex: "none",
        backgroundColor: healthy ? "var(--success-color)" : "var(--error-color)",
        border: `${s.ring}px solid var(--bg-tertiary)`,
        boxShadow: healthy ? "var(--shadow-xs)" : "none",
        ...(overlay
          ? {
              position: "absolute",
              bottom: -2,
              right: -2,
            }
          : {}),
        ...style,
      }}
      {...rest}
    />
  );
}
