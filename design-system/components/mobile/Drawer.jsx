import React, { useEffect, useRef } from "react";

/**
 * Slide-in navigation drawer — triggered by the hamburger button in the
 * mobile TopBar. Slides in from the left at var(--drawer-width) (280px).
 * The header carries the fuse seam as a bottom border, matching the identity
 * of the desktop SidePanel. Focus is trapped inside; Escape and backdrop tap
 * both call onClose.
 *
 * Use on xs/sm screens (<768px) to surface secondary navigation that doesn't
 * fit in the 4-tab BottomNav.
 */
export function Drawer({ open, onClose, header, children, footer, style }) {
  const drawerRef = useRef(null);

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
    const drawer = drawerRef.current;
    if (!drawer) return;
    drawer.focus();

    const getFocusable = () =>
      Array.from(
        drawer.querySelectorAll(
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
    drawer.addEventListener("keydown", handleTab);
    return () => drawer.removeEventListener("keydown", handleTab);
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
        alignItems: "stretch",
      }}
    >
      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="navigation"
        aria-label="Site navigation"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "var(--drawer-width)",
          maxWidth: "80vw",
          height: "100%",
          background: "var(--bg-tertiary)",
          borderRight: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          outline: "none",
          overflowY: "auto",
          paddingTop: "env(safe-area-inset-top, 0px)",
          ...style,
        }}
      >
        {/* Header with seam bottom border */}
        {header && (
          <div
            style={{
              position: "relative",
              padding: "var(--space-4) var(--space-4) var(--space-3)",
              borderBottom: "1px solid var(--border-color)",
              flexShrink: 0,
            }}
          >
            {header}
            {/* Fuse seam — replaces the border so the seam IS the header close */}
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "1px",
                background: "var(--seam)",
                opacity: 0.85,
              }}
            />
          </div>
        )}

        {/* Nav content — grows to fill */}
        <div
          style={{
            flex: 1,
            padding: "var(--space-2)",
            overflowY: "auto",
          }}
        >
          {children}
        </div>

        {/* Optional footer (e.g. user row) */}
        {footer && (
          <div
            style={{
              flexShrink: 0,
              borderTop: "1px solid var(--border-color)",
              padding: "var(--space-2)",
              paddingBottom:
                "calc(var(--space-2) + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {footer}
          </div>
        )}
      </div>

      {/* Tap-to-close rest of the screen */}
      <div style={{ flex: 1 }} />
    </div>
  );
}
