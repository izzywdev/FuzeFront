import { CSSProperties, ElementType, HTMLAttributes, JSX, ReactNode } from "react";

export type CtaBandMaxWidth = "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";

export interface CtaBandProps extends HTMLAttributes<HTMLElement> {
  /** Content column max-width, from Container's `--container-*` scale. Default "3xl". */
  maxWidth?: CtaBandMaxWidth;
  /** Element/component to render as. Default "section". */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The closing CTA band that caps a marketing page — top-bordered surface,
 * vertical padding, centered width-capped content.
 */
export declare function CtaBand(props: CtaBandProps): JSX.Element;
