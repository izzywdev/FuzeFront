import React from "react";

/**
 * PanelHeader — replaces the recurring hand-rolled `ffb-panel__header` block
 * (flex row, space-between, an <h3 className="ffb-panel__title"> plus an
 * optional trailing status/action node) duplicated across billing-ui's panel
 * components (PaymentMethodPanel, SubscriptionManager, UsagePanel). Title +
 * id (for the panel's `aria-labelledby`) on the left; an optional trailing
 * slot (a StatusPill, a badge, an action) on the right via children.
 */
export function PanelHeader({
  id,
  title,
  children,
  style,
  titleStyle,
  ...rest
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        ...style,
      }}
      {...rest}
    >
      <h3
        id={id}
        style={{
          margin: 0,
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-base)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-primary)",
          ...titleStyle,
        }}
      >
        {title}
      </h3>
      {children && (
        <div style={{ flexShrink: 0 }}>{children}</div>
      )}
    </div>
  );
}
