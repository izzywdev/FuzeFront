import * as React from "react";

/**
 * The dashboard launcher card — the primary surface of the runtime fabric.
 * Lifts and reveals the `--seam` top edge on hover; offline apps render
 * grayscaled, dimmed and non-interactive.
 */
export interface AppCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** The app's display name (rendered as the card heading). */
  name: string;
  /** Short blurb shown beneath the heading; omitted if absent. */
  description?: string;
  /** Runtime integration strategy — drives the icon fallback hue and the mono badge. */
  integrationType?: "module-federation" | "iframe" | "web-component" | string;
  /** App icon image URL; falls back to a per-type emoji glyph on error or when absent. */
  iconUrl?: string;
  /** Emoji glyph (e.g. from a manifest `Icon.kind = "emoji"`); overrides the per-type fallback emoji when no `iconUrl`. */
  iconGlyph?: string;
  /** When false, the card is grayscaled, dimmed, inert and tagged "(Offline)". */
  isHealthy?: boolean;
  /** Fired on click / Enter / Space — only when the app is healthy. */
  onClick?: (event: React.SyntheticEvent) => void;
}

export function AppCard(props: AppCardProps): JSX.Element;
