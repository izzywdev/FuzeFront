import React from "react";

/**
 * SectionLede — the centered intro paragraph directly under a section
 * heading on a marketing page (e.g. "Everything your SaaS needs, none of
 * the overhead" -> "FuzeOne bundles the primitives that every product team
 * reinvents..."). Replaces the recurring ad-hoc
 * `className="text-lg text-gray-600 max-w-2xl mx-auto"` pattern duplicated
 * across `fuzefront-website` marketing pages (ds-fp:4d94397a116d).
 *
 * Tokens only: `--text-lg` for size, `--text-secondary` for the gray-600
 * tone (the same mapping already established for gray-500/600 body copy at
 * other migrated call sites, e.g. `Text`'s `tone="secondary"`), and
 * `--container-2xl` (672px) for the max-width cap — matches `max-w-2xl`
 * exactly, the same token `Container` already uses for that width.
 *
 * Unlike a hero lead (dark gradient surface, needs a `data-theme="dark"`
 * pin so its tone token resolves against the dark palette), these call
 * sites sit on the page's ambient *light* theme, so no theme pin is
 * needed here — `--text-secondary` already resolves correctly.
 */
export function SectionLede({
  as: As = "p",
  className,
  style,
  children,
  ...rest
}) {
  const classes = ["ds-section-lede", className].filter(Boolean).join(" ");

  return (
    <As
      className={classes}
      style={{
        margin: 0,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-lg)",
        lineHeight: "var(--leading-normal)",
        color: "var(--text-secondary)",
        textAlign: "center",
        maxWidth: "var(--container-2xl)",
        marginInline: "auto",
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  );
}
