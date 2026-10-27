import React from "react";

/**
 * The default FuzeFront password policy — mirrors the rules the Security API's
 * identity engine (Authentik) actually enforces server-side. Kept here so the
 * hint UI and the client-side "can submit" check share ONE source of truth.
 * Each rule's `test` runs against the raw password string.
 */
export const DEFAULT_PASSWORD_RULES = [
  { id: "length", label: "At least 12 characters", test: (v) => v.length >= 12 },
  { id: "upper", label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "A number", test: (v) => /\d/.test(v) },
  {
    id: "symbol",
    label: "A symbol (e.g. ! ? @ #)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** True when `value` satisfies every rule — the gate for enabling submit. */
export function passwordMeetsPolicy(value, rules = DEFAULT_PASSWORD_RULES) {
  return rules.every((r) => r.test(value || ""));
}

const DotIcon = ({ met }) =>
  met ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flex: "none" }}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" aria-hidden="true" style={{ flex: "none", opacity: 0.7 }}>
      <circle cx="12" cy="12" r="4" />
    </svg>
  );

/**
 * Live password-policy checklist. Given the current password `value`, renders
 * each requirement and marks it met/unmet as the user types. Purely presentational
 * — the parent owns the value and the submit gate (via `passwordMeetsPolicy`).
 * Tokens only; announces politely for assistive tech. Each row carries
 * `data-req` (the rule id) + `data-met` ("true"/"false") and the list carries
 * `data-pwreq`, so tests and analytics can address a rule without parsing copy.
 * `highlightUnmet` tints the still-unmet rules with the error colour (use it
 * after a rejected submit so the user can see what to fix). `columns` lays the
 * rules out in N grid columns; `metLabel`/`unmetLabel` are the
 * visually-hidden per-row suffixes (localize them with the rule labels).
 */
export function PasswordChecklist({
  value = "",
  rules = DEFAULT_PASSWORD_RULES,
  title = "Your password needs:",
  columns = 1,
  highlightUnmet = false,
  metLabel = " — met",
  unmetLabel = " — not met",
  style,
  ...rest
}) {
  return (
    <div
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        marginBlockStart: "var(--space-2)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      {title && (
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-tertiary)",
            lineHeight: 1.3,
          }}
        >
          {title}
        </span>
      )}
      <ul
        data-pwreq
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "var(--space-1) var(--space-3)",
        }}
      >
        {rules.map((rule) => {
          const met = rule.test(value || "");
          return (
            <li
              key={rule.id}
              data-req={rule.id}
              data-met={met ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-medium)",
                lineHeight: 1.3,
                color: met
                  ? "var(--success-color)"
                  : highlightUnmet
                    ? "var(--error-color)"
                    : "var(--text-tertiary)",
              }}
            >
              <DotIcon met={met} />
              <span>{rule.label}</span>
              <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                {met ? metLabel : unmetLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The barrel (build.mjs) only re-exports each file's component by basename, so
// the pure helpers are surfaced as statics on the exported component — this is
// how feature code reaches them via `@fuzefront/design-system` without a subpath
// import. `PasswordChecklist.meetsPolicy(value)` is the submit gate.
PasswordChecklist.meetsPolicy = passwordMeetsPolicy;
PasswordChecklist.rules = DEFAULT_PASSWORD_RULES;
