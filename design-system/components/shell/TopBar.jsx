import React from "react";

/**
 * The host shell header. A fixed-height bar (var(--top-bar-height)) sitting on
 * the deepest surface with a bottom border and the signature "fuse seam" — a 1px
 * indigo->cyan gradient strip glowing along the bottom edge, marking where the
 * shell joins the content the runtime modules render into.
 *
 * Layout: `brand` slot on the left, a flex spacer, then `actions` (or `children`)
 * on the right.
 */
export function TopBar({
  brand,
  actions,
  children,
  style,
  ...rest
}) {
  const right = actions ?? children;
  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        height: "var(--top-bar-height)",
        flex: "none",
        padding: "0 var(--space-5)",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border-color)",
        transition:
          "background-color var(--duration-slow) var(--ease-standard), border-color var(--duration-slow) var(--ease-standard)",
        ...style,
      }}
      {...rest}
    >
      {/* Brand slot (left) */}
      {brand != null && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-3)",
            minWidth: 0,
          }}
        >
          {brand}
        </div>
      )}

      {/* Flex spacer */}
      <div style={{ flex: 1, minWidth: 0 }} />

      {/* Actions slot (right) */}
      {right != null && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          {right}
        </div>
      )}

      {/* Signature fuse seam: 1px indigo->cyan gradient strip along the bottom */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "-1px",
          height: "1px",
          background: "var(--seam)",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
    </header>
  );
}
