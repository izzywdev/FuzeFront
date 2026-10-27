import React from "react";

// ds-fp:ca4dadd873c1 — extracted per issue #968. A decorative icon centered
// above a CTA/section heading recurred with the same raw shape across
// fuzefront-website: `<Icon size={N} className="text-primary-{4|5}00
// mx-auto mb-{4|6}" />` (FuzeHubPage's CTA, PricingPage's enterprise CTA,
// HomePage's newsletter teaser) — a raw Tailwind tone + manual centering +
// manual bottom margin, duplicated at every CTA that leads with an icon.
//
// IconTile covers the "colored icon beside/within a chip" cases (inline or
// boxed); this is the different shape those don't cover — a standalone,
// block-level icon that sits centered above its own heading, with a
// token-driven gap to that heading. The icon's own pixel size stays the
// caller's concern (`<Icon size={40} />` as `children`), same contract as
// IconTile.
const TONES = {
  accent: "var(--accent-color)",
  info: "var(--accent-2)",
  success: "var(--success-color)",
  warning: "var(--warning-color)",
  error: "var(--error-color)",
  neutral: "var(--text-secondary)",
};

const GAP = {
  md: "var(--space-4)", // 16px — the HomePage newsletter-teaser spacing
  lg: "var(--space-6)", // 24px — the FuzeHubPage / PricingPage CTA spacing
};

/**
 * SectionIcon — a tone-colored decorative icon, centered on its own line
 * above a heading, with a token-driven bottom gap. Replaces the raw
 * `<Icon className="text-primary-{N} mx-auto mb-{N}" />` pattern duplicated
 * across marketing CTA sections.
 *
 * The icon itself is passed as `children` (e.g. `<Crown size={40} />`) so
 * the caller keeps full control of which icon and its own `size` — this
 * component only centers it, colors it by `tone`, and spaces it from
 * whatever follows.
 *
 * Decorative by default (`aria-hidden`) since every call site pairs the
 * icon with an adjacent visible heading; pass `label` for a standalone
 * accessible name.
 */
export function SectionIcon({ children, tone = "accent", gap = "lg", label, style, ...rest }) {
  const color = TONES[tone] || TONES.accent;
  const marginBottom = GAP[gap] || GAP.lg;

  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      style={{
        display: "flex",
        justifyContent: "center",
        color,
        marginBottom,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
