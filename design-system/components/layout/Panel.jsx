import React from "react";

/**
 * Panel — replaces the recurring `<section className="ffb-panel">` header +
 * body + actions wrapper duplicated across billing summary cards
 * (PaymentMethodPanel, SubscriptionManager, UsagePanel — issue #893). A
 * titled surface with an optional header-trailing element (e.g. a status
 * pill), a body that is either normal content or a token-styled single-line
 * empty message, and an optional footer row of actions.
 *
 * The heading is associated to the section via `aria-labelledby`; pass
 * `titleId` to reuse an id you already control, otherwise one is generated.
 */
export function Panel({
  title,
  titleId,
  headerAction,
  empty,
  actions,
  children,
  style,
  ...rest
}) {
  const reactId = React.useId();
  const resolvedTitleId = title ? titleId ?? reactId : undefined;

  return (
    <section
      aria-labelledby={resolvedTitleId}
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
      {title && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
          }}
        >
          <h3
            id={resolvedTitleId}
            style={{
              margin: 0,
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
            }}
          >
            {title}
          </h3>
          {headerAction}
        </div>
      )}

      {empty ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
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
