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
 *
 * **Polymorphic.** Renders a real `<a>` (with proper `href`/`target`/`rel`
 * semantics — not a JS `onClick` navigation) whenever `href` is passed, or
 * whenever `as` is given explicitly (a tag name or a component, e.g.
 * react-router-dom's `Link`, for in-app routing). With neither, it renders a
 * native `<button>`, exactly as before. Every variant/size looks identical
 * either way — only the rendered element and its semantics change. This is
 * what makes a "Sign in" / "Launch app" CTA a REAL link: middle-click and
 * ctrl/cmd-click open a new tab, right-click offers "copy link", keyboard
 * users get link (not button) semantics, and crawlers can follow it.
 *
 * An anchor can't carry the native `disabled` attribute, so when `disabled`
 * is set on an anchor-rendered Button it drops `href`, sets
 * `aria-disabled="true"` + `tabIndex={-1}`, and swallows clicks — the same
 * "inert, not just unclickable" contract as a disabled `<button>`.
 */
export function Button({
  children,
  as,
  href,
  variant = "primary",
  size = "md",
  withArrow = false,
  leadingIcon = null,
  fullWidth = false,
  disabled = false,
  style,
  target,
  rel,
  onClick,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const Tag = as || (href ? "a" : "button");
  const isAnchor = Tag !== "button";

  const sharedStyle = {
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
    textDecoration: "none",
    background: v.background,
    color: v.color,
    border: v.border,
    boxShadow: v.boxShadow,
    transition:
      "background var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
    ...style,
  };

  const sharedHandlers = {
    onMouseEnter: (e) => { if (!disabled) e.currentTarget.style.background = v.hover; },
    onMouseLeave: (e) => {
      e.currentTarget.style.background = v.background;
      e.currentTarget.style.transform = "translateY(0)";
    },
    onMouseDown: (e) => { if (!disabled) e.currentTarget.style.transform = "translateY(1px)"; },
    onMouseUp: (e) => { e.currentTarget.style.transform = "translateY(0)"; },
  };

  const content = (
    <>
      {leadingIcon}
      {children}
      {withArrow && <ArrowRight size={s.icon} />}
    </>
  );

  if (isAnchor) {
    // A caller-supplied `rel` is respected; otherwise `target="_blank"`
    // always gets the `noopener noreferrer` safety default (reverse
    // tabnabbing) — the same contract ExternalLink enforces unconditionally.
    const computedRel = rel || (target === "_blank" ? "noopener noreferrer" : undefined);
    // Only forward an `href` key when the caller actually passed one — an
    // `as={Link}`-only usage (in-app routing via `to`) must not have its
    // component's own computed href clobbered by an explicit `href:
    // undefined` landing in `rest`.
    const hrefProp = href !== undefined ? { href: disabled ? undefined : href } : {};
    return (
      <Tag
        target={target}
        rel={computedRel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        style={sharedStyle}
        onClick={disabled ? (e) => e.preventDefault() : onClick}
        {...sharedHandlers}
        {...hrefProp}
        {...rest}
      >
        {content}
      </Tag>
    );
  }

  return (
    <button
      disabled={disabled}
      style={sharedStyle}
      onClick={onClick}
      {...sharedHandlers}
      {...rest}
    >
      {content}
    </button>
  );
}
