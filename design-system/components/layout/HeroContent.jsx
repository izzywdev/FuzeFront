import React from "react";
import { Container } from "./Container.jsx";

/**
 * HeroContent — the content wrapper inside a hero `<section>` that also
 * carries absolutely-positioned decorative layers (gradient overlays,
 * blurred glow blobs, a `hero-pattern` background). Replaces the
 * `<Container size="…" className="relative text-center">` pattern
 * duplicated across the marketing site's hero sections (ds-fp:24ccaa1c7879).
 *
 * `position: relative` establishes a positioning context for the content so
 * it paints/stacks correctly alongside the hero's absolutely-positioned
 * decoration siblings; `text-align: center` centers the hero heading/copy.
 * Both are applied via `style`, not raw Tailwind utility classNames — same
 * token-first approach as `Center`.
 *
 * Wraps `Container`, so `size`/`gutter`/`as` (the hero's max-width and
 * responsive gutter) pass straight through unchanged.
 */
export function HeroContent({ className, style, ...rest }) {
  const classes = ["ds-hero-content", className].filter(Boolean).join(" ");

  return (
    <Container
      className={classes}
      style={{
        position: "relative",
        textAlign: "center",
        ...style,
      }}
      {...rest}
    />
  );
}
