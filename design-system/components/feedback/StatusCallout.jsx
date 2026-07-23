import React from "react";

/**
 * StatusCallout — a soft-tinted inline banner (icon + title + text + actions)
 * for warn / error / info / success states. Larger and more structured than the
 * inline `Alert`: it carries a rounded icon chip, an emphasized title, body copy,
 * and a row of actions, and is used to surface fail-closed guards and load errors.
 *
 * Design-system-first: every color/spacing/type value is a token. RTL-safe via
 * CSS logical properties (gap + logical padding), so it mirrors automatically.
 *
 * A11y: defaults `role` by tone — `alert` for errors (assertively announced),
 * `status` for the rest. The icon is decorative (`aria-hidden`); meaning lives in
 * the title + text. Pass an explicit `role`/`aria-label` to override.
 */
const TONES = {
  error:   { color: "var(--error-color)",   soft: "var(--error-soft)",   role: "alert"  },
  warning: { color: "var(--warning-color)", soft: "var(--warning-soft)", role: "status" },
  success: { color: "var(--success-color)", soft: "var(--success-soft)", role: "status" },
  info:    { color: "var(--accent-color)",  soft: "var(--accent-soft)",  role: "status" },
};

export function StatusCallout({
  tone = "info",
  icon,
  title,
  children,
  actions,
  role,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.info;
  return (
    <div
      role={role ?? t.role}
      style={{
        display: "flex",
        gap: "var(--space-4)",
        alignItems: "flex-start",
        background: t.soft,
        border: `1px solid ${t.color}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4) var(--space-5)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {icon != null && (
        <span
          aria-hidden="true"
          style={{
            flex: "none",
            width: "28px",
            height: "28px",
            borderRadius: "var(--radius-pill)",
            display: "grid",
            placeItems: "center",
            background: t.soft,
            color: t.color,
            fontSize: "var(--text-md)",
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <p
            style={{
              margin: "0 0 var(--space-1)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-md)",
              color: "var(--text-primary)",
            }}
          >
            {title}
          </p>
        )}
        {children != null && (
          <p
            style={{
              margin: 0,
              color: "var(--text-secondary)",
              fontSize: "var(--text-sm)",
              lineHeight: "var(--leading-normal, 1.5)",
            }}
          >
            {children}
          </p>
        )}
        {actions != null && (
          <div
            style={{
              marginTop: "var(--space-3)",
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-3)",
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
