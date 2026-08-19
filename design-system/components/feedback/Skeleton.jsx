import React from "react";

/**
 * Loading-placeholder block — a token-colored rectangle with the same shimmer
 * the DataTable skeleton uses. Use it to reserve layout while content loads
 * (e.g. pricing cards before plans arrive). Decorative: marked aria-hidden, so
 * give the surrounding region an aria-busy/loading label instead.
 */
export function Skeleton({
  width = "100%",
  height = "var(--space-4)",
  radius = "var(--radius-sm)",
  style,
  ...rest
}) {
  return (
    <>
      <style>{`
        @keyframes ds-skeleton-pulse {
          from { opacity: 1; }
          to   { opacity: 0.4; }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          width,
          height,
          background: "var(--bg-quaternary)",
          borderRadius: radius,
          animation:
            "ds-skeleton-pulse var(--duration-slow, 320ms) ease-in-out infinite alternate",
          ...style,
        }}
        {...rest}
      />
    </>
  );
}
