import React from "react";

/**
 * A vertical, ordered progress list — each step numbered, with a `done` /
 * `current` / `pending` state. Built for the Stripe Connect onboarding
 * checklist (Portal Admin → Billing) but generic for any multi-step
 * onboarding/setup flow. `done` steps get a success-tinted number badge;
 * `current` gets an accent-tinted card so the in-flight step reads clearly.
 * Exposes `aria-current="step"` on the current item for assistive tech.
 */
export function Stepper({ steps = [], style, ...rest }) {
  return (
    <ol
      data-stepper=""
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        ...style,
      }}
      {...rest}
    >
      {steps.map((step, i) => {
        const status = step.status || "pending";
        const done = status === "done";
        const current = status === "current";
        return (
          <li
            key={step.id ?? i}
            data-step-status={status}
            aria-current={current ? "step" : undefined}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-5)",
              border: "1px solid",
              borderColor: done
                ? "var(--success-color)"
                : current
                ? "var(--accent-color)"
                : "var(--border-color)",
              borderRadius: "var(--radius-md)",
              background: current ? "var(--accent-soft)" : "transparent",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                width: "24px",
                height: "24px",
                display: "grid",
                placeItems: "center",
                borderRadius: "var(--radius-pill)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
                background: done ? "var(--success-soft)" : "var(--bg-quaternary)",
                color: done ? "var(--success-color)" : "var(--text-secondary)",
                border: "1px solid",
                borderColor: done ? "var(--success-color)" : "var(--border-color)",
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-md)",
                  color: "var(--text-primary)",
                }}
              >
                {step.title}
              </div>
              {step.description && (
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-tertiary)",
                    marginTop: "var(--space-1)",
                  }}
                >
                  {step.description}
                </div>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
