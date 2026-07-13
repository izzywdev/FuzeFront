import React from "react";

/**
 * Empty-state placeholder — replaces inline "No items found" text blocks.
 * `compact` mode is suitable for dropdowns; default mode is a full centered block.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
  style,
  ...rest
}) {
  if (compact) {
    return (
      <div
        style={{
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          color: "var(--text-tertiary)",
          textAlign: "center",
          ...style,
        }}
        {...rest}
      >
        {title}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-8) var(--space-4)",
        fontFamily: "var(--font-sans)",
        color: "var(--text-secondary)",
        textAlign: "center",
        gap: "var(--space-3)",
        ...style,
      }}
      {...rest}
    >
      {icon && (
        <div style={{ fontSize: "2rem", lineHeight: 1 }}>{icon}</div>
      )}
      {title && (
        <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
          {title}
        </div>
      )}
      {body && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", maxWidth: "340px" }}>
          {body}
        </div>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
