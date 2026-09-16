import React from "react";
import { Badge } from "../core/Badge.jsx";

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="var(--success-color)"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ flex: "none", marginTop: "3px" }}
  >
    <path d="M13 4.5L6 11.5L3 8.5" />
  </svg>
);

/**
 * Industry-standard pricing/plan card. Token-driven (no raw hex/spacing/type).
 *
 * The `recommended` tier is BOTH visually highlighted (accent border + glow)
 * AND labelled with a "Recommended" badge — never color alone. The `current`
 * state is conveyed textually ("Current plan" + a success badge) and disables
 * the CTA so a11y/SR users get the same signal sighted users do.
 *
 * `price` is a pre-formatted string (e.g. "$9") so the card stays
 * currency/locale-agnostic; `interval` renders as "/month" etc.
 */
export function PricingCard({
  tierName,
  price,
  interval,
  description,
  features = [],
  recommended = false,
  current = false,
  ctaLabel,
  onSelect,
  busy = false,
  disabled = false,
  style,
  ...rest
}) {
  const label = ctaLabel || (current ? "Current plan" : "Choose plan");
  const isDisabled = disabled || busy || current;
  const accentCta = recommended && !isDisabled;

  return (
    <div
      role="group"
      aria-label={`${tierName} plan`}
      aria-current={current ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-6)",
        background: "var(--bg-tertiary)",
        border: recommended
          ? "var(--border-width-strong) solid var(--accent-color)"
          : "var(--border-width) solid var(--border-color)",
        borderRadius: "var(--radius-lg)",
        boxShadow: recommended ? "var(--shadow-accent)" : "var(--shadow-sm)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          minHeight: "var(--space-6)",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-display)",
            color: "var(--text-primary)",
          }}
        >
          {tierName}
        </h3>
        {recommended ? (
          <Badge tone="accent">Recommended</Badge>
        ) : current ? (
          <Badge tone="success" dot>
            Current
          </Badge>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-1)" }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-3xl)",
            fontWeight: "var(--weight-bold)",
            letterSpacing: "var(--tracking-display)",
            color: "var(--text-primary)",
          }}
        >
          {price}
        </span>
        {interval && (
          <span
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-tertiary)",
            }}
          >
            /{interval}
          </span>
        )}
      </div>

      {description && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-secondary)",
          }}
        >
          {description}
        </p>
      )}

      {features.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            flex: 1,
          }}
        >
          {features.map((feature, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-2)",
                fontSize: "var(--text-sm)",
                lineHeight: "var(--leading-snug)",
                color: "var(--text-secondary)",
              }}
            >
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={isDisabled ? undefined : onSelect}
        disabled={isDisabled}
        aria-busy={busy || undefined}
        style={{
          marginTop: "auto",
          width: "100%",
          padding: "var(--space-3) var(--space-4)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          color: accentCta ? "var(--primary-foreground)" : "var(--text-primary)",
          background: accentCta ? "var(--accent-color)" : "var(--bg-quaternary)",
          border:
            "var(--border-width) solid " +
            (accentCta ? "transparent" : "var(--border-color)"),
          borderRadius: "var(--radius-md)",
          cursor: isDisabled ? "not-allowed" : "pointer",
          opacity: isDisabled && !current ? 0.6 : 1,
          transition: "background var(--duration-fast) var(--ease-standard)",
        }}
      >
        {busy ? "Working…" : label}
      </button>
    </div>
  );
}
