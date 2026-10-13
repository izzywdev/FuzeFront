import React from "react";

/**
 * An inline accent-colored link — replaces the recurring ad-hoc
 * `className="text-{shade}-600 hover:text-{shade}-700"` pattern used for a
 * same-tab/in-page text link (e.g. a "Privacy Policy" reference inside a
 * paragraph, a social-icon link). Color is the ONLY concern this component
 * owns: it reads the DS accent scale (`--accent-color` / `--accent-hover`)
 * instead of a raw/Tailwind color utility, so every such link stays in sync
 * with one token pair. Everything else — size, weight, layout, spacing,
 * underline — is the caller's concern via `className`/`style`, so it drops
 * into the surrounding Tailwind (or inline-style) layout unchanged.
 *
 * Polymorphic via `as` (default `"a"`): pass a router `Link` to keep in-app
 * navigation client-side, or `"button"` for a text-styled inline action
 * (e.g. a toast's action button) — the element's own semantics are the
 * caller's choice, never assumed here. All other props (`href`/`to`,
 * `target`, `rel`, `onClick`, `aria-label`, `data-*`, …) are forwarded as-is;
 * this component does not alter navigation behavior.
 */
export function TextLink({ as: As = "a", children, style, ...rest }) {
  return (
    <As
      {...rest}
      style={{
        color: "var(--accent-color)",
        cursor: "pointer",
        transition: "color var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--accent-hover)";
        if (rest.onMouseEnter) rest.onMouseEnter(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--accent-color)";
        if (rest.onMouseLeave) rest.onMouseLeave(e);
      }}
      onFocus={(e) => {
        e.currentTarget.style.color = "var(--accent-hover)";
        if (rest.onFocus) rest.onFocus(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.color = "var(--accent-color)";
        if (rest.onBlur) rest.onBlur(e);
      }}
    >
      {children}
    </As>
  );
}
