import React from "react";

/**
 * Loading spinner — replaces the `animate-spin ... border-t-transparent rounded-full`
 * Tailwind div pattern. Pure CSS @keyframes, no class dependencies.
 */
export function Spinner({
  size = 32,
  color = "var(--accent-color)",
  label = "Loading",
  style,
  ...rest
}) {
  const thickness = Math.max(2, Math.round(size / 8));
  return (
    <>
      <style>{`
        @keyframes ds-spinner-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        role="status"
        aria-label={label}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          border: `${thickness}px solid currentColor`,
          borderTopColor: "transparent",
          borderRadius: "50%",
          color,
          animation: "ds-spinner-spin 0.7s linear infinite",
          flexShrink: 0,
          ...style,
        }}
        {...rest}
      />
    </>
  );
}
