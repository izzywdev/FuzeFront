import React from "react";

// Visually hidden but still read by assistive tech (same technique as the
// password-reveal label in Input.jsx): the standard 1px clip, not a design value.
const SR_ONLY = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

const DEFAULT_STATUS_LABELS = {
  done: "Completed",
  current: "Current step",
  failed: "Failed",
  cancelled: "Cancelled",
  pending: "Not started",
};

// Glyph shown in the vertical step badge. The number is used for `current` and
// `pending` so the step order stays readable.
const GLYPH = { done: "✓", failed: "✕", cancelled: "–" };

// Vertical (card list) status styling. Every value is a token.
const VERTICAL = {
  done: {
    border: "var(--success-color)",
    badgeBg: "var(--success-soft)",
    badgeFg: "var(--success-color)",
    badgeBorder: "var(--success-color)",
    title: "var(--text-primary)",
  },
  current: {
    border: "var(--accent-color)",
    background: "var(--accent-soft)",
    badgeBg: "var(--bg-quaternary)",
    badgeFg: "var(--text-secondary)",
    badgeBorder: "var(--border-color)",
    title: "var(--text-primary)",
  },
  failed: {
    border: "var(--error-color)",
    badgeBg: "var(--error-soft)",
    badgeFg: "var(--error-color)",
    badgeBorder: "var(--error-color)",
    title: "var(--error-color)",
  },
  cancelled: {
    border: "var(--border-strong)",
    badgeBg: "var(--bg-quaternary)",
    badgeFg: "var(--text-tertiary)",
    badgeBorder: "var(--border-strong)",
    title: "var(--text-tertiary)",
  },
  pending: {
    border: "var(--border-color)",
    badgeBg: "var(--bg-quaternary)",
    badgeFg: "var(--text-secondary)",
    badgeBorder: "var(--border-color)",
    title: "var(--text-primary)",
  },
};

// Horizontal (segmented bar) status styling — the bar colour carries the state,
// the title colour/weight reinforces it.
const HORIZONTAL = {
  done: { bar: "var(--success-color)", name: "var(--text-secondary)" },
  current: { bar: "var(--seam)", name: "var(--text-primary)", weight: "var(--weight-semibold)" },
  failed: { bar: "var(--error-color)", name: "var(--error-color)" },
  cancelled: { bar: "var(--border-strong)", name: "var(--text-tertiary)" },
  pending: { bar: "var(--bg-quaternary)", name: "var(--text-tertiary)" },
};

/**
 * An ordered progress indicator — each step has a `done` / `current` /
 * `failed` / `cancelled` / `pending` state. Generic for any multi-step flow:
 * an onboarding checklist, a wizard header, a build/deploy pipeline.
 *
 * Two layouts (`orientation`):
 * - `vertical` (default) — a card list; `done` gets a success-tinted check badge,
 *   `current` an accent-tinted card. Built for the Stripe Connect checklist.
 * - `horizontal` — equal-width segments, each a status-coloured bar over its
 *   title; wraps to fewer columns on narrow screens. Built for a build pipeline
 *   (launching → building → deploying → deployed).
 *
 * Accessibility: an ordered list; the current step carries `aria-current="step"`;
 * each step's status is also exposed as visually-hidden text (override the words
 * with `statusLabels` to localise) so state is never conveyed by colour or glyph
 * alone. Pass `aria-label` to name the list, and `aria-live="polite"` if step
 * changes should be announced. Layout uses logical properties and grid, so it
 * mirrors under `dir="rtl"`.
 */
export function Stepper({
  steps = [],
  orientation = "vertical",
  statusLabels,
  style,
  ...rest
}) {
  const labels = { ...DEFAULT_STATUS_LABELS, ...statusLabels };
  const horizontal = orientation === "horizontal";

  return (
    <ol
      data-stepper=""
      data-orientation={horizontal ? "horizontal" : "vertical"}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        ...(horizontal
          ? {
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--space-16) * 2), 1fr))",
              gap: "var(--space-2)",
            }
          : { display: "flex", flexDirection: "column", gap: "var(--space-3)" }),
        ...style,
      }}
      {...rest}
    >
      {steps.map((step, i) => {
        const status = DEFAULT_STATUS_LABELS[step.status] ? step.status : "pending";
        const current = status === "current";
        const shared = {
          "data-step": step.id,
          "data-step-status": status,
          // Same state in the vocabulary of the approved app-builder frames.
          "data-step-state": status === "pending" ? "todo" : status,
          "aria-current": current ? "step" : undefined,
        };

        if (horizontal) {
          const v = HORIZONTAL[status];
          return (
            <li
              key={step.id ?? i}
              {...shared}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minInlineSize: 0 }}
            >
              <span
                aria-hidden="true"
                data-step-bar=""
                style={{
                  display: "block",
                  blockSize: "var(--space-1)",
                  borderRadius: "var(--radius-pill)",
                  background: v.bar,
                }}
              />
              <span style={SR_ONLY}>{labels[status]}</span>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-sm)",
                  fontWeight: v.weight || "var(--weight-regular)",
                  color: v.name,
                  overflowWrap: "anywhere",
                }}
              >
                {step.title}
              </span>
              {step.description && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  {step.description}
                </span>
              )}
            </li>
          );
        }

        const v = VERTICAL[status];
        return (
          <li
            key={step.id ?? i}
            {...shared}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-5)",
              border: "1px solid",
              borderColor: v.border,
              borderRadius: "var(--radius-md)",
              background: v.background || "transparent",
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
                background: v.badgeBg,
                color: v.badgeFg,
                border: "1px solid",
                borderColor: v.badgeBorder,
              }}
            >
              {GLYPH[status] ?? i + 1}
            </span>
            <span>
              <span style={SR_ONLY}>{labels[status]}</span>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: "var(--weight-medium)",
                  fontSize: "var(--text-md)",
                  color: v.title,
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
