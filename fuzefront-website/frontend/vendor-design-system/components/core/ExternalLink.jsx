import React from "react";

const ExternalIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }} aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </svg>
);

const VARIANTS = {
  // A filled accent CTA — the primary "launch" action (e.g. "Open portal").
  button: {
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--accent-color)",
    background: "var(--accent-color)",
    color: "#fff",
    boxShadow: "var(--shadow-accent)",
    textDecoration: "none",
  },
  // A quiet inline text link — accent-colored, no chrome.
  link: {
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--accent-color)",
    boxShadow: "none",
    textDecoration: "none",
  },
};

/**
 * A link to a resource on ANOTHER host, always opened in a NEW tab. Renders
 * a real `<a target="_blank" rel="noopener noreferrer">` — never a JS
 * `window.open()` (which can be popup-blocked) and never wired to a same-tab
 * navigation. `target`/`rel` are applied AFTER spreading the caller's props,
 * so they can't be accidentally overridden — this component's entire reason
 * to exist is that the external-navigation contract is non-negotiable.
 *
 * An external-arrow glyph is always appended so the affordance is
 * unmistakably external before the click (WCAG 3.2.5 — no unannounced
 * context change). Use `variant="button"` for a primary launch action (a
 * filled accent CTA) or the default `variant="link"` for an inline
 * reference link.
 */
export function ExternalLink({
  children,
  variant = "link",
  style,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.link;
  return (
    <a
      {...rest}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        whiteSpace: "nowrap",
        cursor: "pointer",
        transition:
          "background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard)",
        ...v,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (variant === "button") e.currentTarget.style.background = "var(--accent-hover)";
        else e.currentTarget.style.opacity = "0.8";
      }}
      onMouseLeave={(e) => {
        if (variant === "button") e.currentTarget.style.background = "var(--accent-color)";
        else e.currentTarget.style.opacity = "1";
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = "2px solid var(--accent-color)";
        e.currentTarget.style.outlineOffset = "2px";
        if (rest.onFocus) rest.onFocus(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = "none";
        if (rest.onBlur) rest.onBlur(e);
      }}
    >
      {children}
      <ExternalIcon />
    </a>
  );
}
