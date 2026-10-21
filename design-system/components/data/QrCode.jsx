import React from "react";

/**
 * QR code renderer. Pure and encoder-agnostic: it draws a module matrix
 * (`modules[row][col] === true` is a dark module) that the caller computes with
 * whatever QR encoder it ships — the design system carries no encoder
 * dependency. Rendered as a single SVG path on a fixed light plate (`--paper`)
 * with dark modules (`--ink-900`) in BOTH themes: scanners need dark-on-light
 * contrast, so this deliberately does not follow the theme.
 */
export function QrCode({
  modules,
  label = "QR code",
  size = "calc(var(--space-12) * 3.5)",
  quietZone = 4,
  style,
  ...rest
}) {
  const n = Array.isArray(modules) ? modules.length : 0;
  if (n === 0) return null;
  const total = n + quietZone * 2;
  let d = "";
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (modules[r][c]) d += `M${c + quietZone} ${r + quietZone}h1v1h-1z`;
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      style={{
        width: size,
        height: size,
        display: "block",
        background: "var(--paper)",
        borderRadius: "var(--radius-md)",
        ...style,
      }}
      {...rest}
    >
      <path d={d} fill="var(--ink-900)" />
    </svg>
  );
}
