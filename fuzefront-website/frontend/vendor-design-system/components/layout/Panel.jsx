import React, { useId } from "react";

/**
 * Standard bordered content panel — header (title + optional trailing status)
 * over an optional empty-state message or body content, with an optional
 * actions row. This is the recurring "card with a titled header" shape used
 * throughout dashboards (subscription/usage/payment summaries, settings
 * sections, …): a `<section>` labelled by its own heading rather than a
 * generic `<div>`, so assistive tech announces it as a region.
 *
 * Pass `empty` to render a muted empty-state paragraph in place of
 * `children` (e.g. "No payment method on file"); omit it to render
 * `children` normally. `trailing` sits beside the title (e.g. a StatusPill).
 */
export function Panel({
  title,
  titleId,
  trailing,
  empty,
  actions,
  children,
  style,
  ...rest
}) {
  const generatedId = useId();
  const headingId = titleId || generatedId;

  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-5)",
        background: "var(--bg-tertiary)",
        border: "var(--border-width) solid var(--border-color)",
        borderRadius: "var(--radius-lg)",
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <h3
          id={headingId}
          style={{
            margin: 0,
            fontSize: "var(--text-base)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h3>
        {trailing}
      </div>

      {empty != null ? (
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
          }}
        >
          {empty}
        </p>
      ) : (
        children
      )}

      {actions && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginBlockStart: "var(--space-1)",
          }}
        >
          {actions}
        </div>
      )}
    </section>
  );
}
