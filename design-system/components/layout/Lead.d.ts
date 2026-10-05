import * as React from "react";

export type LeadMaxWidth = "2xl" | "3xl" | "4xl" | "none";

export interface LeadProps extends React.HTMLAttributes<HTMLElement> {
  /** Rendered element. @default "p" */
  as?: React.ElementType;
  /**
   * Step of the DS --container-* content-width scale. `"none"` removes the
   * cap.
   * @default "2xl"
   */
  maxWidth?: LeadMaxWidth;
  /** Apply `margin-inline: auto` (logical, RTL-safe) to center the block. @default true */
  centered?: boolean;
  children?: React.ReactNode;
}

/**
 * Hero/section lead paragraph — replaces the recurring ad-hoc
 * `className="text-xl text-gray-600 max-w-{2xl,3xl} mx-auto"` pattern.
 */
export function Lead(props: LeadProps): React.JSX.Element;
