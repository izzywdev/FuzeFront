import React from "react";

/**
 * InfoRow — replaces the recurring `flex items-center justify-between p-4
 * bg-gray-50 rounded-lg` pattern used for settings/preferences row items.
 * Label + optional description on the left; right slot (button/toggle) via children.
 */
export function InfoRow({
  label,
  description,
  children,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        padding: "var(--space-4)",
        background: "var(--bg-tertiary)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && (
          <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
            {label}
          </div>
        )}
        {description && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: "var(--space-1)" }}>
            {description}
          </div>
        )}
      </div>
      {children && (
        <div style={{ flexShrink: 0 }}>{children}</div>
      )}
    </div>
  );
}
