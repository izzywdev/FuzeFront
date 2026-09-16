import React from "react";

const TONES = {
  error:   { fg: "var(--error-color)",   bg: "rgba(231, 76, 60, 0.08)",   bar: "var(--error-color)" },
  warning: { fg: "var(--warning-color)", bg: "rgba(245, 166, 35, 0.08)",  bar: "var(--warning-color)" },
  success: { fg: "var(--success-color)", bg: "rgba(39, 174, 96, 0.08)",   bar: "var(--success-color)" },
  info:    { fg: "var(--accent-2)",      bg: "rgba(41, 211, 230, 0.08)",  bar: "var(--accent-2)" },
};

/**
 * Inline alert banner — replaces the recurring `border: 1px solid var(--error-color)`
 * div pattern. Use `tone` to pick the severity; content goes in `children`.
 */
export function Alert({
  tone = "error",
  title,
  children,
  onDismiss,
  role = "alert",
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.error;
  return (
    <div
      role={role}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        background: t.bg,
        border: `1px solid ${t.fg}`,
        borderInlineStart: `4px solid ${t.bar}`,
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        color: t.fg,
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-1)" }}>
            {title}
          </div>
        )}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "20px",
            height: "20px",
            padding: 0,
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-sm)",
            color: t.fg,
            cursor: "pointer",
            fontSize: "var(--text-sm)",
            opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
