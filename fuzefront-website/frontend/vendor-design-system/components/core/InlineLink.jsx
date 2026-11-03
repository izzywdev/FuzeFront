import React from "react";

/**
 * InlineLink — a quiet accent-colored link that sits INSIDE a sentence or
 * paragraph (a `mailto:` contact address in body copy, an in-text
 * reference) rather than standing alone as a CTA. Replaces the recurring
 * ad-hoc `className="text-primary-{600,700} hover:underline"` pattern
 * duplicated across the marketing site's legal/contact copy
 * (ds-fp:2861112fc6bd).
 *
 * Unlike `ExternalLink`, this does NOT force `target="_blank"` or append an
 * external-arrow glyph — a `mailto:` address or an in-page reference is not
 * "launched" to another host, so those affordances would be misleading
 * here. If the destination truly is another host that should open in a new
 * tab, use `ExternalLink` (`variant="link"`) instead.
 *
 * No underline by default; underline appears on hover AND keyboard focus
 * (so keyboard users get the same affordance mouse users do, not just the
 * focus ring) — mirrors Tailwind's `hover:underline` call sites exactly,
 * plus the focus case they were missing. `emphasis` covers the handful of
 * call sites that additionally bolded the link (`font-medium`).
 */
export function InlineLink({
  children,
  emphasis = false,
  style,
  ...rest
}) {
  return (
    <a
      {...rest}
      style={{
        color: "var(--accent-color)",
        textDecoration: "none",
        fontWeight: emphasis ? "var(--weight-medium)" : "inherit",
        cursor: "pointer",
        transition: `text-decoration var(--duration-fast) var(--ease-standard)`,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = "underline";
        if (rest.onMouseEnter) rest.onMouseEnter(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = "none";
        if (rest.onMouseLeave) rest.onMouseLeave(e);
      }}
      onFocus={(e) => {
        e.currentTarget.style.textDecoration = "underline";
        e.currentTarget.style.outline = "2px solid var(--accent-color)";
        e.currentTarget.style.outlineOffset = "2px";
        if (rest.onFocus) rest.onFocus(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.textDecoration = "none";
        e.currentTarget.style.outline = "none";
        if (rest.onBlur) rest.onBlur(e);
      }}
    >
      {children}
    </a>
  );
}
