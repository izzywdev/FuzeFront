import React from "react";

const SIZES = {
  sm: { box: "30px", radius: "var(--radius-sm)", icon: 16 },
  md: { box: "38px", radius: "var(--radius-md)", icon: 18 },
  lg: { box: "44px", radius: "var(--radius-md)", icon: 20 },
};

/**
 * Icon-only ghost button — square, transparent until hovered. The host
 * shell's quiet control (notification bell, theme toggle). `label` is
 * required and drives both the tooltip and the accessible name.
 */
export function IconButton({
  children,
  label,
  size = "md",
  active = false,
  disabled = false,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: s.box,
        height: s.box,
        padding: 0,
        flex: "none",
        background: active ? "var(--bg-quaternary)" : "transparent",
        color: active ? "var(--accent-color)" : "var(--text-primary)",
        border: "1px solid transparent",
        borderRadius: s.radius,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        lineHeight: 0,
        transition:
          "background var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active)
          e.currentTarget.style.background = "var(--bg-quaternary)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.94)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
