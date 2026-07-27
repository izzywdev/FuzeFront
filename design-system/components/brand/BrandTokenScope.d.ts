import * as React from "react";

/** Verdict of validating a candidate portal accent color. */
export interface BrandAccentResolution {
  /** True when `accent` was valid and passed the WCAG AA contrast gate. */
  applied: boolean;
  /** Why the accent was rejected: `"none"` (not provided), `"invalid"`
   * (unparsable), `"contrast"` (parses but fails AA), or `null` when applied. */
  reason: "none" | "invalid" | "contrast" | null;
  /** Computed contrast ratio against the on-accent text color, when known. */
  ratio?: number;
  /** The accepted accent color (echoes the input), when applied. */
  accentColor?: string;
  /** Derived hover shade, when applied. */
  accentHover?: string;
  /** Derived 14%-alpha soft tint, when applied. */
  accentSoft?: string;
}

/**
 * Validate a candidate portal accent color and compute the scoped
 * `--accent-*` override BrandTokenScope would apply, without mounting React.
 */
export function resolveBrandAccent(accent: string | null | undefined): BrandAccentResolution;

export interface BrandTokenScopeProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onAccentRejected"> {
  /** Candidate portal accent (`branding.accent`) — hex / rgb(a) / hsl(a). A
   * malformed or WCAG-AA-failing value is rejected; the scope then renders
   * with no override so children inherit the base/ancestor accent. */
  accent?: string | null;
  /** Optional secondary accent (`--accent-2`); validated for CSS-color
   * syntax only (no contrast gate — it is never used as a text color). */
  accent2?: string | null;
  /** Element/component to render as. @default "div" */
  as?: React.ElementType;
  /** Called when `accent` is rejected, with the reason and computed ratio
   * (when known) — e.g. to log a telemetry event or surface an admin warning. */
  onAccentRejected?: (info: { accent: string; reason: "invalid" | "contrast"; ratio?: number }) => void;
}

/**
 * Applies a validated portal brand accent as a scoped CSS-var override layered
 * over the base `@fuzefront/design-system` tokens, with WCAG 2.1 AA contrast
 * fallback and malformed-color rejection (FF-EPIC-13 S3 AC3/AC4).
 */
export function BrandTokenScope(props: BrandTokenScopeProps): JSX.Element;
