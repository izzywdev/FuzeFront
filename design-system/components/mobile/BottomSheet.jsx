import React, { useEffect, useRef } from "react";

/**
 * Bottom sheet — the mobile equivalent of Modal. Slides up from the bottom
 * of the screen, capped at var(--sheet-max-h) (80dvh). The fuse seam appears
 * as a full-width gradient line just below the drag handle, marking this as
 * a brand-native surface. Focus is trapped inside; Escape and backdrop tap
 * both call onClose.
 *
 * On md+ screens (≥768px) prefer Modal instead.
 */
export function BottomSheet({ open, onClose, title, children, style }) {
  const sheetRef = useRef(null);
  const titleId = useRef(
    "sheet-title-" + Math.random().toString(36).slice(2, 8)
  ).current;

  /* ---- Escape key -------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  /* ---- Focus trap -------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.focus();

    const getFocusable = () =>
      Array.from(
        sheet.querySelectorAll(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.closest("[aria-hidden]"));

    const handleTab = (e) => {
      if (e.key !== "Tab") return;
      const nodes = getFocusable();
      if (!nodes.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    sheet.addEventListener("keydown", handleTab);
    return () => sheet.removeEventListener("keydown", handleTab);
  }, [open]);

  /* ---- Body scroll lock -------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: "var(--z-modal)",
        background: "var(--scrim)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {/* Sheet panel */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "var(--sheet-max-h)",
          overflowY: "auto",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
          outline: "none",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          ...style,
        }}
      >
        {/* Drag handle */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "10px 0 4px",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "3px",
              borderRadius: "999px",
              background: "var(--border-strong)",
            }}
          />
        </div>

        {/* Fuse seam — brand moment below the drag handle */}
        <div
          aria-hidden="true"
          style={{
            height: "1.5px",
            background: "var(--seam)",
            margin: "0 var(--space-4) var(--space-4)",
          }}
        />

        {/* Content */}
        <div
          style={{
            padding: "0 var(--space-5) var(--space-6)",
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
