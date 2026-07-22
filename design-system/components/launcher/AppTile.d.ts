import * as React from "react";

/**
 * The launcher app tile — a compact icon + name cell for the 9-dots app grid,
 * modeled on the Google app launcher. No description, no integration badge;
 * offline apps render grayscaled, dimmed and non-interactive. Use `AppCard`
 * for the full-detail dashboard / management surfaces.
 */
export interface AppTileProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** The app's display name (menu label), rendered beneath the icon. */
  name: string;
  /** Runtime integration strategy — drives the icon fallback hue/emoji. */
  integrationType?: "module-federation" | "iframe" | "web-component" | string;
  /** App icon image URL; falls back to a per-type emoji glyph on error or when absent. */
  iconUrl?: string;
  /** Emoji glyph (e.g. from a manifest `Icon.kind = "emoji"`); overrides the per-type fallback emoji when no `iconUrl`. */
  iconGlyph?: string;
  /** When false, the tile is grayscaled, dimmed and inert. */
  isHealthy?: boolean;
  /** Fired on click / Enter / Space — only when the app is healthy. */
  onClick?: (event: React.SyntheticEvent) => void;
}

export function AppTile(props: AppTileProps): JSX.Element;
