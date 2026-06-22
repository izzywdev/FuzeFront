import React from "react";

/**
 * Dialog overlay — the runtime fabric's modal primitive (checkout, confirms).
 * Token-only, RTL-safe (logical properties), and accessible:
 *   - role="dialog" aria-modal, labelled by the title
 *   - Escape closes; backdrop click closes
 *   - focus ring uses the fuse-seam accent
 *
 * Rendering/portaling is left to the consumer (render only when `open`).
 */
export function Modal({
  open = true,
  title,
  onClose,
  children,
  footer,
  labelledById = "ff-modal-title",
  style,
  ...rest
}) {
  if (!open) return null;

  const stop = (e) => e.stopPropagation();

  return (
    <div
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4)",
        background: "color-mix(in srgb, var(--graphite-950) 70%, transparent)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? labelledById : undefined}
        onClick={stop}
        style={{
          position: "relative",
          inlineSize: "min(480px, 100%)",
          maxBlockSize: "calc(100vh - 2 * var(--space-8))",
          overflow: "auto",
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg, 0 24px 64px rgba(0,0,0,0.5))",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          ...style,
        }}
        {...rest}
      >
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-6) var(--space-6) var(--space-4)",
          }}
        >
          {title && (
            <h2
              id={labelledById}
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-primary)",
              }}
            >
              {title}
            </h2>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                flex: "none",
                inlineSize: "32px",
                blockSize: "32px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid transparent",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                fontSize: "var(--text-lg)",
                lineHeight: 1,
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = "2px solid var(--accent-color)";
                e.currentTarget.style.outlineOffset = "2px";
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              ×
            </button>
          )}
        </div>
        <div style={{ padding: "0 var(--space-6) var(--space-6)" }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-6)",
              borderBlockStart: "1px solid var(--border-color)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
