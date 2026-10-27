import { CSSProperties, ElementType, HTMLAttributes, JSX, ReactNode } from "react";

export interface SectionTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Heading element to render. Defaults to `h2` (an in-page section); use `h1` for a page's own title. */
  as?: ElementType;
  /** Text alignment. Defaults to `center` — every known call site renders centered. */
  align?: "left" | "center";
  /** Bottom-margin step: `md` (default, `mb-4`) or `sm` (`mb-3`, the legal-page variant). */
  space?: "sm" | "md";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export declare function SectionTitle(props: SectionTitleProps): JSX.Element;
