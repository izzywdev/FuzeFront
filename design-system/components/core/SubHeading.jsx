import React from "react";
import { Text } from "./Text.jsx";

// Top-margin scale for the gap before a SubHeading that follows a preceding
// paragraph within the same section (`mt-4` / `mt-5` were the two values
// actually seen at the extraction call sites) — DS spacing tokens only.
const SPACE_TOP = {
  none: "0",
  md: "var(--space-4)",
  lg: "var(--space-5)",
};

// Bottom-margin scale for the gap before the subheading's own body copy
// (`mb-2` was the value seen at every extraction call site) — DS spacing
// tokens only.
const SPACE_BOTTOM = {
  none: "0",
  sm: "var(--space-2)",
};

/**
 * SubHeading — a small bold subsection heading inside a block of body copy,
 * e.g. a numbered legal-document subsection ("6.1 GDPR Rights (EEA
 * Residents)", "4.1 Subscription Fees"). Replaces the recurring ad-hoc
 * `className="text-base font-semibold text-gray-800 mb-2[ mt-{4,5}]"`
 * pattern duplicated across the legal pages.
 *
 * Composes `Text` for color/size (never forks its tone or type scale —
 * `primary` (default) reads `--text-primary`, and `size="base"` reads
 * `--text-base`) and adds the two things `Text` deliberately leaves to the
 * caller: the DS `--weight-semibold` font weight, and a `space` prop for
 * the top-margin gap before a subheading that follows a preceding
 * paragraph in the same section.
 */
export function SubHeading({
  as = "h3",
  tone = "primary",
  space = "none",
  spacing = "sm",
  children,
  style,
  ...rest
}) {
  return (
    <Text
      as={as}
      tone={tone}
      size="base"
      style={{
        fontWeight: "var(--weight-semibold)",
        marginBlockStart: SPACE_TOP[space] ?? SPACE_TOP.none,
        marginBlockEnd: SPACE_BOTTOM[spacing] ?? SPACE_BOTTOM.sm,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
