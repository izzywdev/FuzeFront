import * as React from "react";

/**
 * Icon button that toggles the host shell between dark and light themes,
 * flipping document data-theme. Shows a moon in dark mode, a sun in light.
 */
export interface ThemeToggleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onToggle"> {
  /** Current theme; selects the icon (moon in dark, sun in light). */
  theme?: "dark" | "light";
  /**
   * Called after data-theme is set, with the newly applied theme value.
   * Use it to sync app state / persist the choice.
   */
  onToggle?: (next: "dark" | "light", event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ThemeToggle(props: ThemeToggleProps): JSX.Element;
