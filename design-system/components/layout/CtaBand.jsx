import React from "react";
import { Container } from "./Container.jsx";
import { Center } from "./Center.jsx";

/**
 * CtaBand — the closing "talk to us" / "get started" call-to-action band
 * that caps a marketing page: a full-bleed section separated from the
 * content above by a top border, generous vertical padding, and a
 * centered, width-capped content column (heading + copy + action
 * buttons). Replaces the `py-20 bg-white border-t border-gray-100`
 * section wrapper + `max-w-{2xl,3xl} mx-auto px-4 text-center` inner
 * column duplicated across the marketing site's page-ending CTAs
 * (ds-fp:34f37eee010f).
 *
 * Composes {@link Container} (width cap + responsive gutter) and
 * {@link Center} (text-align: center) rather than re-deriving either —
 * this component owns only the outer band surface (background / top
 * border / vertical padding). `maxWidth` picks the content column's cap
 * from Container's `--container-*` token scale; callers vary between
 * `"2xl"` and `"3xl"` depending on copy length.
 */
export function CtaBand({
  maxWidth = "3xl",
  as: Component = "section",
  className,
  style,
  children,
  ...rest
}) {
  return (
    <Component
      className={className}
      style={{
        paddingBlock: "var(--space-20)",
        background: "var(--bg-tertiary)",
        borderBlockStart: "var(--border-width) solid var(--border-color)",
        ...style,
      }}
      {...rest}
    >
      <Container size={maxWidth}>
        <Center>{children}</Center>
      </Container>
    </Component>
  );
}
