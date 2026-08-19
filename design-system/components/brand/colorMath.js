/* Pure color-parsing + WCAG contrast math for BrandTokenScope. No DOM/canvas
 * dependency (jsdom does not reliably parse arbitrary CSS color strings), so
 * this is a small self-contained parser for the formats a portal admin's
 * color picker actually emits: #hex (3/4/6/8), rgb()/rgba(), hsl()/hsla().
 * CSS named colors ("red") and functional notation we don't recognize are
 * intentionally rejected — fail closed rather than silently accept an
 * unvalidated string into a CSS custom property.
 *
 * This file lives in the DS token-definition layer (design-system/), which
 * `gate-ds-conformance` excludes from the raw-value scan — the numeric
 * literals below (channel math, gamma constants) are the primitive's
 * implementation, not app-level hard-coded design values.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(-?[\d.]+)\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*(-?\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*(-?[\d.]+)\s*)?\)$/i;

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s)) / 100;
  l = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/**
 * Parse a CSS color string into `[r, g, b]` (0-255 each), or `null` if the
 * string is not a recognized, well-formed hex/rgb(a)/hsl(a) color. Rejects
 * out-of-range channel values (e.g. `rgb(300, 0, 0)`) rather than clamping —
 * a malformed value should fail closed, not be silently coerced.
 */
export function parseCssColor(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;

  const hexMatch = HEX_RE.exec(value);
  if (hexMatch) return hexToRgb(value);

  const rgbMatch = RGB_RE.exec(value);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const rgb = [Number(r), Number(g), Number(b)];
    if (rgb.some((c) => c > 255)) return null;
    return rgb;
  }

  const hslMatch = HSL_RE.exec(value);
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    if (Number(s) > 100 || Number(l) > 100) return null;
    return hslToRgb(Number(h), Number(s), Number(l));
  }

  return null;
}

/** True if `input` parses as a well-formed hex/rgb(a)/hsl(a) color. */
export function isValidCssColor(input) {
  return parseCssColor(input) !== null;
}

function srgbChannelToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an `[r, g, b]` triple. */
export function relativeLuminance([r, g, b]) {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG contrast ratio (1–21) between two `[r, g, b]` triples. */
export function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Darken an `[r, g, b]` triple toward black by `amount` (0–1). */
export function darken([r, g, b], amount) {
  const f = 1 - amount;
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

export function toRgbaString([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function toHexString([r, g, b]) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** The text color composed on top of `--accent-color` everywhere in this DS
 * (see components/core/Button.jsx primary variant) — the reference used to
 * gate a candidate portal accent for WCAG AA (>= 4.5:1) readability. */
export const ON_ACCENT_RGB = [255, 255, 255];

/** WCAG 2.1 AA contrast minimum for normal-weight text/labels. */
export const AA_CONTRAST_MIN = 4.5;
