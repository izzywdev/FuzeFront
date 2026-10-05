import { CSSProperties, ElementType, HTMLAttributes, JSX, ReactNode } from "react";

export interface CtaHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading element to render. Defaults to `h2`. */
  as?: ElementType;
  /** Text alignment. Defaults to `center` — every known call site renders centered. */
  align?: "left" | "center";
  /** Bottom-margin step: `none`, `sm` (`--space-2`), or `md` (default, `mb-4`). */
  space?: "none" | "sm" | "md";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export declare function CtaHeading(props: CtaHeadingProps): JSX.Element;
