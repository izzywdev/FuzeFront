import React from "react";

/**
 * Surface container — the panel/card primitive the runtime fabric uses for
 * grouped content (plan cards, settings panels, summaries). Token-only.
 *
 * `seam` adds the indigo->cyan fuse-seam accent along the block-start edge,
 * marking a "joined"/highlighted surface (e.g. the recommended plan).
 * `interactive` lifts on hover for clickable cards.
 */
export function Card({
  children,
  seam = false,
  interactive = false,
  padded = true,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-lg)",
        padding: padded ? "var(--space-6)" : 0,
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        transition:
          "transform var(--duration-fast) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!interactive) return;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.borderColor = "var(--accent-color)";
      }}
      onMouseLeave={(e) => {
        if (!interactive) return;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "var(--border-color)";
      }}
      {...rest}
    >
      {seam && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            insetBlockStart: 0,
            insetInlineStart: 0,
            inlineSize: "100%",
            blockSize: "3px",
            background: "var(--seam)",
          }}
        />
      )}
      {children}
    </div>
  );
}
