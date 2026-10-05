import React from "react";

// The `text-lg` → `text-xl` step at the `sm` breakpoint needs a real media
// query, which inline styles can't express — same one-scoped-<style>
// pattern Container already uses for its responsive gutter.
const SIZE_CSS = `
  .ds-hero-lead { font-size: var(--text-lg); }
  @media (min-width: 640px) {
    .ds-hero-lead { font-size: var(--text-xl); }
  }
`;

/**
 * HeroLead — replaces the `text-lg sm:text-xl text-secondary-300 max-w-2xl
 * mx-auto leading-relaxed` paragraph duplicated across every marketing-site
 * page hero (ds-fp:d4affa5c8b4a): About, Careers, Press.
 *
 * Page heroes render on a dark gradient surface regardless of the page's
 * own ambient theme — `fuzefront-website`'s `App.tsx` pins
 * `data-theme="light"` on `<main>` for the page content below the hero, so
 * a plain `Text`/`var(--text-secondary)` read here would resolve to the
 * LIGHT palette's ink color (`--ink-600`) and go near-illegible on the dark
 * hero background. That ambient-theme mismatch is exactly why the call
 * sites reached for a raw Tailwind `text-secondary-300` instead of a DS
 * token in the first place. This component pins its own `data-theme="dark"`
 * so `--text-secondary` always resolves to the dark palette's
 * `--graphite-300`, independent of the ambient theme — tokens only, no raw
 * color/size/width values.
 */
export function HeroLead({ as: As = "p", className, style, children, ...rest }) {
  const classes = ["ds-hero-lead", className].filter(Boolean).join(" ");

  return (
    <>
      <style>{SIZE_CSS}</style>
      <As
        data-theme="dark"
        className={classes}
        style={{
          fontFamily: "var(--font-sans)",
          color: "var(--text-secondary)",
          lineHeight: "var(--leading-relaxed)",
          margin: 0,
          maxWidth: "var(--container-2xl)",
          marginInline: "auto",
          ...style,
        }}
        {...rest}
      >
        {children}
      </As>
    </>
  );
}
