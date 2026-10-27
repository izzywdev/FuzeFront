import React from "react";
import { Input } from "./Input.jsx";
import { FieldLabel } from "./FieldLabel.jsx";

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * Text field with a live validation state: an END-edge adornment (a check when
 * `state="valid"`), a success / error ring, a label row that can carry an
 * `accessory` (an inline "Checking… / Available / Already registered" status
 * on the logical end of the label), and optional help / error lines.
 *
 * It composes the base `Input` (the adornment + ring live there) and the
 * `FieldLabel`; nothing is re-implemented. Everything is positioned with
 * logical properties, so the adornment and accessory mirror under `dir="rtl"`.
 *
 * States: `idle` (neutral) · `checking` (neutral, `aria-busy`) · `valid` (success
 * ring + check) · `invalid` (error ring, `aria-invalid`, message in `error` or
 * explained by `help`/`accessory`).
 */
export function InlineValidatedInput({
  label,
  accessory,
  state = "idle",
  help,
  error = "",
  id,
  required = false,
  style,
  "aria-describedby": describedBy,
  ...rest
}) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const helpId = help ? `${fieldId}-help` : undefined;
  const described = [describedBy, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {(label || accessory) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            marginBlockEnd: "var(--space-2)",
          }}
        >
          {label && (
            <FieldLabel htmlFor={fieldId} required={required} style={{ marginBlockEnd: 0 }}>
              {label}
            </FieldLabel>
          )}
          {accessory && (
            <span
              role="status"
              aria-live="polite"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-medium)",
                lineHeight: 1.3,
              }}
            >
              {accessory}
            </span>
          )}
        </div>
      )}
      <Input
        id={fieldId}
        error={error}
        valid={state === "valid"}
        invalid={state === "invalid"}
        adornment={
          state === "valid" ? (
            <span style={{ color: "var(--success-color)", display: "inline-flex" }}>
              <CheckIcon />
            </span>
          ) : undefined
        }
        aria-busy={state === "checking" || undefined}
        aria-describedby={described}
        data-state={state}
        style={style}
        {...rest}
      />
      {help && (
        <p
          id={helpId}
          style={{
            margin: 0,
            marginBlockStart: "var(--space-2)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            color: "var(--text-tertiary)",
            lineHeight: 1.4,
          }}
        >
          {help}
        </p>
      )}
    </div>
  );
}
