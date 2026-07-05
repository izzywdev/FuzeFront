import React from "react";

const ArrowRight = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const SIZES = {
  sm: { padding: "8px 16px", font: "var(--text-xs)", icon: 14 },
  md: { padding: "12px 24px", font: "var(--text-sm)", icon: 16 },
  lg: { padding: "16px 32px", font: "var(--text-md)", icon: 18 },
};

const VARIANTS = {
  primary: {
    background: "var(--accent-color)",
    color: "#fff",
    border: "1px solid transparent",
    boxShadow: "var(--shadow-accent)",
    hover: "var(--accent-hover)",
  },
  secondary: {
    background: "var(--bg-quaternary)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-color)",
    boxShadow: "none",
    hover: "var(--bg-tertiary)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid transparent",
    boxShadow: "none",
    hover: "var(--bg-quaternary)",
  },
  danger: {
    background: "var(--error-color)",
    color: "#fff",
    border: "1px solid transparent",
    boxShadow: "none",
    hover: "var(--error-color)",
  },
};

/**
 * Pill-ish action button — `primary` carries the accent fuse glow; the host
 * shell's signature CTA ("Launch app", "Connect remote", "Sign in").
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  withArrow = false,
  leadingIcon = null,
  fullWidth = false,
  disabled = false,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      disabled={disabled}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : "auto",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: s.padding,
        fontFamily: "var(--font-sans)",
        fontSize: s.font,
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1,
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
        background: v.background,
        color: v.color,
        border: v.border,
        boxShadow: v.boxShadow,
        transition:
          "background var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = v.hover; }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = v.background;
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(1px)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
      {...rest}
    >
      {leadingIcon}
      {children}
      {withArrow && <ArrowRight size={s.icon} />}
    </button>
  );
}
