import React from "react";

/**
 * Sidebar navigation row for the host shell. Default rows are quiet
 * (--text-secondary); hover raises them; the active row carries the
 * runtime "fuse seam" as a 3px bar on its left edge.
 */
export function MenuItem({
  icon,
  label,
  active = false,
  onClick,
  style,
  ...rest
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(e);
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        margin: "var(--space-1) var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: active ? "var(--weight-semibold)" : "var(--weight-regular)",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--accent-soft)" : "transparent",
        userSelect: "none",
        transition:
          "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--bg-quaternary)";
          e.currentTarget.style.color = "var(--text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
      {...rest}
    >
      {/* The fuse seam: a rounded indigo->cyan bar marking the active row. */}
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: "3px",
            height: "1.1rem",
            borderRadius: "3px",
            background: "var(--seam)",
          }}
        />
      )}
      {icon != null && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
