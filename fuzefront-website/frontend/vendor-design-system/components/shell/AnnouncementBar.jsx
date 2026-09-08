import React, { useState } from "react";

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/**
 * Dismissable announcement strip rendered above the TopBar.
 * Accepts either a `message` string + optional `href` link, or arbitrary `children`.
 * Disappears on close; pass `onClose` to sync state externally.
 */
export function AnnouncementBar({
  badge,
  message,
  linkLabel,
  href,
  children,
  onClose,
  style,
  ...rest
}) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  const handleClose = () => {
    setVisible(false);
    onClose && onClose();
  };

  return (
    <div
      role="banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 20px",
        background: "var(--accent-soft)",
        borderBottom: "1px solid var(--border-color)",
        fontSize: "var(--text-sm)",
        color: "var(--text-primary)",
        ...style,
      }}
      {...rest}
    >
      {badge && (
        <span style={{
          background: "var(--accent-color)",
          color: "#fff",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          padding: "2px 8px",
          borderRadius: "var(--radius-xs)",
          flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
      <span style={{ flex: 1, color: "var(--text-primary)" }}>
        {children || message}
        {linkLabel && href && (
          <>
            {" "}
            <a href={href} style={{
              color: "var(--accent-2)",
              textDecoration: "none",
              fontWeight: "var(--weight-medium)",
            }}>
              {linkLabel} →
            </a>
          </>
        )}
      </span>
      <button
        aria-label="Dismiss announcement"
        onClick={handleClose}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-tertiary)",
          padding: "4px",
          borderRadius: "var(--radius-sm)",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          transition: "color var(--duration-fast) var(--ease-standard)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
