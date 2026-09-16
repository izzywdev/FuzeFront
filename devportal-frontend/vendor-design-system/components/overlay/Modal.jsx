import React, { useEffect, useRef } from "react";

/**
 * Generic accessible modal shell — backdrop + centered dialog card with the
 * fuse-seam top bar. Focus-traps Tab/Shift+Tab inside; closes on Escape and
 * backdrop click.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  style,
}) {
  const dialogRef = useRef(null);
  const titleId = useRef(
    "modal-title-" + Math.random().toString(36).slice(2, 8)
  ).current;

  /* ---- Escape key -------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  /* ---- Focus trap -------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Focus the dialog on open
    dialog.focus();

    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.closest("[aria-hidden]"));

    const handleTab = (e) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener("keydown", handleTab);
    return () => dialog.removeEventListener("keydown", handleTab);
  }, [open]);

  if (!open) return null;

  const maxWidth =
    size === "lg" ? "var(--modal-max-w-lg)" : "var(--modal-max-w)";

  return (
    /* Backdrop */
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--shadow)",
        padding: "var(--space-4)",
      }}
    >
      {/* Dialog card */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: "relative",
          width: "100%",
          maxWidth,
          maxHeight: "calc(100vh - var(--space-8))",
          overflowY: "auto",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg)",
          outline: "none",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Seam top bar — 2px gradient matching .auth-form seam pattern */}
        <div
          aria-hidden="true"
          style={{
            flex: "none",
            height: "2px",
            width: "100%",
            background: "var(--seam)",
            borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
          }}
        />

        {/* Content */}
        <div
          style={{
            padding: "var(--space-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {title && (
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-primary)",
                lineHeight: 1.3,
              }}
            >
              {title}
            </h2>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
