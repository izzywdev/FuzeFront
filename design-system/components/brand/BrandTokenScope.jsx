import React from "react";
import {
  parseCssColor,
  isValidCssColor,
  contrastRatio,
  darken,
  toRgbaString,
  ON_ACCENT_RGB,
  AA_CONTRAST_MIN,
} from "./colorMath.js";

/**
 * Resolve a candidate portal `accent` color into the scoped `--accent-*`
 * override BrandTokenScope will apply, or a fallback verdict when the
 * candidate is unusable. Exported standalone so the validation/contrast
 * logic is unit-testable without mounting React.
 *
 * Fail-closed: an unparsable color ("invalid") or one that cannot reach
 * WCAG 2.1 AA (>= 4.5:1) against the white on-accent text this DS renders
 * on accent surfaces ("contrast") both fall back to the base DS accent
 * tokens — never an unreadable or malformed override.
 */
export function resolveBrandAccent(accent) {
  if (accent == null || accent === "") {
    return { applied: false, reason: "none" };
  }
  const rgb = parseCssColor(accent);
  if (!rgb) {
    return { applied: false, reason: "invalid" };
  }
  const ratio = contrastRatio(rgb, ON_ACCENT_RGB);
  if (ratio < AA_CONTRAST_MIN) {
    return { applied: false, reason: "contrast", ratio };
  }
  return {
    applied: true,
    reason: null,
    ratio,
    accentColor: accent,
    accentHover: `rgb(${darken(rgb, 0.14).join(", ")})`,
    accentSoft: toRgbaString(rgb, 0.14),
  };
}

/**
 * Applies a validated portal brand accent as a scoped CSS-custom-property
 * override layered OVER the base `@fuzefront/design-system` tokens — never a
 * fork of the tokens, only a re-point of `--accent-color` / `--accent-hover`
 * / `--accent-soft` (and optionally `--accent-2`) for everything rendered
 * inside it. A malformed or WCAG-AA-failing `accent` is rejected and the
 * scope renders with NO override, so children inherit whatever base/ancestor
 * accent is already cascading (FF-EPIC-13 S3 AC3/AC4).
 */
export function BrandTokenScope({
  accent,
  accent2,
  as: As = "div",
  children,
  style,
  onAccentRejected,
  ...rest
}) {
  const resolved = React.useMemo(() => resolveBrandAccent(accent), [accent]);

  React.useEffect(() => {
    if (!resolved.applied && resolved.reason !== "none" && onAccentRejected) {
      onAccentRejected({ accent, reason: resolved.reason, ratio: resolved.ratio });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.applied, resolved.reason]);

  const accent2Valid = accent2 != null && isValidCssColor(accent2);

  const overrideVars = resolved.applied
    ? {
        "--accent-color": resolved.accentColor,
        "--accent-hover": resolved.accentHover,
        "--accent-soft": resolved.accentSoft,
        ...(accent2Valid ? { "--accent-2": accent2 } : {}),
      }
    : {};

  return (
    <As
      data-brand-scope=""
      data-brand-accent-status={resolved.applied ? "applied" : "fallback"}
      {...(resolved.applied
        ? {}
        : { "data-brand-fallback-reason": resolved.reason })}
      style={{ ...overrideVars, ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}
