import React from "react";

/**
 * TextLink — a quiet, same-tab inline navigation link: footer nav rows
 * ("Terms of Service" / "Contact Us" / "Back to Home"), a "back to X" link,
 * or any other small accent-colored link that stays within the app/site
 * (never opens a new tab — for that, use `ExternalLink`). Replaces the
 * recurring ad-hoc `className="text-{shade} hover:text-{darker-shade}
 * text-sm font-medium"` pattern duplicated across marketing-site pages
 * (ds-fp:97a8a8e06595).
 *
 * Polymorphic via `as`: defaults to a plain `<a href>`, but pass
 * `as={Link}` (react-router-dom) with a `to` prop for in-app routing — the
 * same `as` convention `Button`/`ExternalLink`/`Container` already use.
 *
 * Color reads from the DS accent pair — `--accent-color` at rest,
 * `--accent-hover` on hover/focus — never a raw Tailwind color shade.
 */
export function TextLink({ as: Component = "a", children, style, onMouseEnter, onMouseLeave, onFocus, onBlur, ...rest }) {
  return (
    <Component
      {...rest}
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        color: "var(--accent-color)",
        textDecoration: "none",
        cursor: "pointer",
        transition: "color var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--accent-hover)";
        if (onMouseEnter) onMouseEnter(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--accent-color)";
        if (onMouseLeave) onMouseLeave(e);
      }}
      onFocus={(e) => {
        e.currentTarget.style.color = "var(--accent-hover)";
        e.currentTarget.style.outline = "2px solid var(--accent-color)";
        e.currentTarget.style.outlineOffset = "2px";
        if (onFocus) onFocus(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.color = "var(--accent-color)";
        e.currentTarget.style.outline = "none";
        if (onBlur) onBlur(e);
      }}
    >
      {children}
    </Component>
  );
}
