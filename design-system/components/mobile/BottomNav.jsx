import React from "react";

/**
 * Bottom navigation bar — the mobile equivalent of SidePanel. Renders at the
 * bottom of the viewport on xs/sm screens (<768px), replacing the side panel.
 *
 * Height is var(--bottom-nav-height) + env(safe-area-inset-bottom) so it
 * clears the home indicator on iOS. The active tab is marked with the fuse
 * seam as a 16×2px pill above its icon, and its label + icon flip to
 * --accent-color. Maximum 4 items — more nav goes in a Drawer.
 */
export function BottomNav({ items = [], activeId, onSelect, style, ...rest }) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: "var(--z-sticky)",
        display: "flex",
        alignItems: "stretch",
        height: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: "var(--bg-secondary)",
        borderTop: "1px solid var(--border-color)",
        ...style,
      }}
      {...rest}
    >
      {items.slice(0, 4).map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect?.(item.id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "2px",
              padding: "5px 4px 8px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              minWidth: 0,
              minHeight: "var(--touch-target)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Seam indicator — 16×2px pill above icon when active */}
            <span
              aria-hidden="true"
              style={{
                display: "block",
                width: active ? "16px" : "4px",
                height: "2px",
                borderRadius: "999px",
                background: active ? "var(--seam)" : "transparent",
                marginBottom: "2px",
                transition:
                  "width var(--duration-base) var(--ease-standard)",
                flexShrink: 0,
              }}
            />

            {/* Icon */}
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.25rem",
                lineHeight: 1,
                color: active
                  ? "var(--accent-color)"
                  : "var(--text-tertiary)",
                transition:
                  "color var(--duration-base) var(--ease-standard)",
              }}
            >
              {item.icon}
            </span>

            {/* Label */}
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.6875rem",
                fontWeight: active ? 600 : 400,
                lineHeight: 1,
                color: active
                  ? "var(--accent-color)"
                  : "var(--text-tertiary)",
                transition:
                  "color var(--duration-base) var(--ease-standard)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
