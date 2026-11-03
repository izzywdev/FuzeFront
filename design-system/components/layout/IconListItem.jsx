import React from "react";

// ds-fp:66ca5c4e6a54 — extracted per issue #975. The same "tone-colored,
// top-aligned, non-shrinking leading icon beside text" row recurred across
// fuzefront-website: a challenge/use-case checklist row (IndustriesPage,
// ProductDetailPage) and a pricing plan's included/excluded feature row
// (PricingPage) all repeated the identical icon className
// (`text-success-500 flex-shrink-0 mt-0.5`, and its excluded-feature sibling
// `text-gray-300 flex-shrink-0 mt-0.5`) — same shape, only the icon glyph,
// tone and row chrome varied. One primitive covers all of them: it owns the
// row layout (flex, top-aligned, gapped) and the icon's tone/size/alignment,
// tokens only; callers keep full control of the icon glyph and of their own
// text styling, exactly like ListStack owns the list container and leaves
// `<li>` content to the caller.

const GAP = {
  xs: "var(--space-1)",
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
};

const TONE_COLOR = {
  success: "var(--success-color)",
  warning: "var(--warning-color)",
  error: "var(--error-color)",
  accent: "var(--accent-color)",
  neutral: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
};

/**
 * IconListItem — a row with a tone-colored leading icon, aligned to the top
 * of its (possibly multi-line) text instead of centered on the full row
 * height. Replaces the recurring
 * `<li className="flex items-start gap-2 …"><Icon className="text-X-500 flex-shrink-0 mt-0.5" />…</li>`
 * pattern: this component owns the row layout (flex, `align-items: flex-start`,
 * token-driven gap) and the icon's tone, size and non-shrinking top-aligned
 * placement — callers still choose which icon to render (passed as `icon`,
 * a component, e.g. `CheckCircle2` from `lucide-react`) and still fully own
 * their own text content/styling as `children`, the same division of
 * responsibility ListStack uses for its `<li>` items.
 *
 * `as`: `li` (default, for use inside a `ListStack`/`<ul>`) or `div` (a
 * free-standing row, e.g. a card use-case list that isn't a semantic list).
 * `tone`: maps to the same DS tone tokens as `IconTile`'s `plain` variant
 * (`success` default, plus `warning`/`error`/`accent`/`neutral`), with
 * `muted` added for a de-emphasized/excluded-item icon (`--text-tertiary`).
 * `size`: icon pixel size passed straight to the `icon` component (default
 * `14`, matching the bullet-list call sites; pass `18` for a larger
 * stand-alone row like a use-case card).
 *
 * The icon is decorative by default (`aria-hidden`) since every call site
 * pairs it with adjacent visible text — the row's accessible name comes from
 * `children`, not the icon.
 */
export function IconListItem({
  as = "li",
  icon: Icon,
  tone = "success",
  size = 14,
  gap = "sm",
  children,
  style,
  ...rest
}) {
  const Tag = as;
  const color = TONE_COLOR[tone] || TONE_COLOR.success;
  return (
    <Tag
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: GAP[gap] || GAP.sm,
        ...style,
      }}
      {...rest}
    >
      {Icon ? (
        <Icon
          size={size}
          aria-hidden="true"
          style={{ flex: "none", marginTop: "2px", color }}
        />
      ) : null}
      {children}
    </Tag>
  );
}
