import React from "react";

const CloseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

// Left-bar color per level — info uses the cyan accent (--accent-2),
// mirroring Toaster.tsx LEVEL_COLORS in the host shell.
const LEVELS = {
  success: { bar: "var(--success-color)" },
  warning: { bar: "var(--warning-color)" },
  error: { bar: "var(--error-color)" },
  info: { bar: "var(--accent-2)" },
};

/**
 * A single toast notification — bg-tertiary card with a colored left bar
 * keyed to the level. The "fuse seam" runtime fabric surfacing a status.
 */
export function Toast({
  level = "info",
  title,
  message,
  onDismiss,
  style,
  ...rest
}) {
  const l = LEVELS[level] || LEVELS.info;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        maxWidth: "360px",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--bg-tertiary)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-color)",
        borderLeft: `4px solid ${l.bar}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
              marginBottom: "var(--space-1)",
            }}
          >
            {title}
          </div>
        )}
        <div
          style={{
            fontSize: "var(--text-sm)",
            lineHeight: 1.4,
            color: "var(--text-secondary)",
            wordBreak: "break-word",
          }}
        >
          {message}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            width: "24px",
            height: "24px",
            padding: 0,
            marginTop: "-2px",
            marginRight: "-4px",
            background: "transparent",
            color: "var(--text-tertiary)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
            transition: "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-quaternary)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
