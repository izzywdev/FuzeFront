import * as React from "react";

/**
 * The FuzeFront wordmark — "Fuze" in the --seam gradient + "Front" in solid text,
 * the signature "runtime fuse seam" lockup used in the host shell's top bar.
 */
export interface BrandMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Wordmark scale; also drives the optional logo height. */
  size?: "sm" | "md" | "lg";
  /** Optional logo image src, rendered to the left of the wordmark. */
  logo?: string;
  /** Alt text for the logo image (also the accessible product name). */
  alt?: string;
}

export function BrandMark(props: BrandMarkProps): JSX.Element;
