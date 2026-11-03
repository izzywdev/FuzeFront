import React from "react";
import { Text } from "./Text.jsx";

// Bottom-margin scale for the gap the call sites hard-coded as a Tailwind
// `mb-*` utility (`mb-2` / `mb-3` were the two values actually seen at the
// extraction call sites) — DS spacing tokens only.
const SPACE_BOTTOM = {
  sm: "var(--space-2)",
  md: "var(--space-3)",
};

/**
 * GroupLabel — a small uppercase heading that introduces a labelled group of
 * content inside a card or section (e.g. "Responsibilities",
 * "Qualifications", "Key challenges addressed", "Recommended products").
 * Replaces the recurring ad-hoc `className="text-xs font-semibold
 * text-gray-{600,900} uppercase tracking-wider mb-{2,3}"` pattern.
 *
 * Not `Eyebrow`: `Eyebrow` is a pill-shaped accent label (background chip +
 * accent dot) that sits above a big section/hero heading. `GroupLabel` is a
 * plain inline heading — no pill, no dot, no accent color — that sits
 * directly above a sub-list or sub-block *inside* a card.
 *
 * Composes `Text` for its size/tone (reusing the DS type scale and
 * text-color scale rather than forking them) and adds the three things this
 * pattern needs that `Text` deliberately leaves to the caller: the semibold
 * weight, the uppercase/wide-tracking treatment, and the bottom-margin gap.
 */
export function GroupLabel({
  as = "h4",
  tone = "secondary",
  spacing = "sm",
  children,
  style,
  ...rest
}) {
  return (
    <Text
      as={as}
      tone={tone}
      size="xs"
      style={{
        fontWeight: "var(--weight-semibold)",
        textTransform: "uppercase",
        letterSpacing: "var(--tracking-wide)",
        marginBlockEnd: SPACE_BOTTOM[spacing] ?? SPACE_BOTTOM.sm,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Text>
  );
}
