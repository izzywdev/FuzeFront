import * as React from "react";

export type CenterProps<E extends React.ElementType = "div"> = {
  /** Element/component to render as (e.g. `"div"`, `"section"`, or an
   * animation wrapper like framer-motion's `motion.div`). @default "div" */
  as?: E;
  children?: React.ReactNode;
  style?: React.CSSProperties;
} & Omit<React.ComponentPropsWithoutRef<E>, "as" | "children" | "style">;

/**
 * Horizontally centers block content — replaces the ad-hoc
 * `className="text-center"` div duplicated across feature code.
 */
export function Center<E extends React.ElementType = "div">(
  props: CenterProps<E>
): React.JSX.Element;
