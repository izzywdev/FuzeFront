import React from "react";

// ds-fp:3c82e6a49a9f — extracted per issue #936. The same "colored icon"
// block recurred across fuzefront-website: a fixed-size rounded chip with a
// tone-tinted background wrapping a lucide icon (perks/contact/leadership/
// legal-page headers), a neutral-surface variant on the dark shell
// (FuzeHubPage's feature list), and a bare tone-colored icon with no box at
// all (notification icon, inline heading icons). One primitive, three
// variants, covers all of them — tokens only, zero raw hex/px-outside-scale.
const SIZES = {
  sm: { box: "36px", radius: "var(--radius-md)" },
  md: { box: "44px", radius: "var(--radius-lg)" },
  lg: { box: "56px", radius: "var(--radius-xl)" },
};

const TONES = {
  accent: { color: "var(--accent-color)", soft: "var(--accent-soft)" },
  info: {
    color: "var(--accent-2)",
    soft: "color-mix(in srgb, var(--accent-2) 14%, transparent)",
  },
  success: { color: "var(--success-color)", soft: "var(--success-soft)" },
  warning: { color: "var(--warning-color)", soft: "var(--warning-soft)" },
  error: { color: "var(--error-color)", soft: "var(--error-soft)" },
  neutral: { color: "var(--text-secondary)", soft: "var(--bg-quaternary)" },
};

/**
 * IconTile — a tone-colored icon, optionally on a rounded chip.
 *
 * `variant`:
 *  - `soft` (default): fixed-size rounded box, background is a soft tint of
 *    `tone`, icon rendered in the solid `tone` color. The recurring
 *    "perk/contact/legal-header" chip.
 *  - `surface`: fixed-size rounded box on a neutral card surface
 *    (`--bg-quaternary`) instead of a tone tint, icon still in the solid
 *    `tone` color. For an icon tile sitting on an already-dark/colored
 *    section, where a second tint would fight the surface.
 *  - `plain`: no box at all — just tints `children` in the solid `tone`
 *    color, inline. For an icon that sits directly beside text (a heading,
 *    a notification row) with no chip.
 *
 * The icon itself is passed as `children` (e.g. `<Mail size={24} />`) so the
 * caller keeps full control of which icon and its own `size` — `size` here
 * only sizes the surrounding box (ignored by `variant="plain"`).
 *
 * Decorative by default (`aria-hidden`) since every call site pairs the icon
 * with adjacent visible text; pass `label` for a standalone accessible name.
 */
export function IconTile({
  children,
  tone = "accent",
  size = "md",
  variant = "soft",
  label,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.accent;
  const s = SIZES[size] || SIZES.md;

  if (variant === "plain") {
    return (
      <span
        {...(label
          ? { role: "img", "aria-label": label }
          : { "aria-hidden": "true" })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          lineHeight: 0,
          color: t.color,
          ...style,
        }}
        {...rest}
      >
        {children}
      </span>
    );
  }

  const background = variant === "surface" ? "var(--bg-quaternary)" : t.soft;

  return (
    <span
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": "true" })}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: s.box,
        height: s.box,
        borderRadius: s.radius,
        background,
        color: t.color,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
