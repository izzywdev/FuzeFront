import React from "react";

/**
 * PageShell — replaces the `className="bg-white pt-16"` wrapper duplicated
 * across the marketing site's top-level page components (ds-fp:1c4f8daa8bda):
 * BlogPage, ContactPage, SolutionsPage. Each of those pages renders directly
 * under the site's `fixed` 64px-tall Header, so the outermost element needs
 * (1) a solid light page background so content doesn't show through to the
 * dark shell behind it, and (2) top padding equal to the header's height so
 * the first section isn't rendered underneath it.
 *
 * Background uses the DS semantic token `--bg-secondary` (resolves to
 * `--paper` / #ffffff under the light theme these marketing pages pin via
 * `data-theme="light"`) rather than a literal white, so it still tracks the
 * token if the palette ever changes. Padding uses `paddingBlockStart` (the
 * logical-property equivalent of padding-top) on the `--space-16` (64px)
 * step — a top offset has no inline direction, so this is for token/API
 * consistency with the rest of the DS's logical-property components, not
 * an RTL requirement.
 *
 * Polymorphic via `as`, matching Center/Wrap, for the rare case a page needs
 * something other than a plain `<div>` as its outermost element.
 */
export function PageShell({ as: Component = "div", style, className, children, ...rest }) {
  return (
    <Component
      className={className}
      style={{
        background: "var(--bg-secondary)",
        paddingBlockStart: "var(--space-16)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
}
