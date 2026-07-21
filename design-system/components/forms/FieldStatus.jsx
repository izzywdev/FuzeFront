import React from "react";
import { Spinner } from "../feedback/Spinner.jsx";

const CheckIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" style={{ flex: "none" }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const CrossIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" style={{ flex: "none" }}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const TONE = {
  checking: "var(--text-tertiary)",
  success: "var(--success-color)",
  error: "var(--error-color)",
  idle: "var(--text-tertiary)",
};

/**
 * Inline field-status line — the availability/validation feedback that sits
 * directly under a text field. Drives four states: `idle` (nothing shown),
 * `checking` (spinner), `success` (check), `error` (cross). An optional `action`
 * node (e.g. a "sign in instead" link) renders after the message.
 *
 * Announces changes politely (aria-live) so async results reach a screen reader
 * without stealing focus. Tokens only.
 */
export function FieldStatus({
  state = "idle",
  message = "",
  action = null,
  style,
  ...rest
}) {
  const tone = TONE[state] ?? TONE.idle;
  const showContent = state !== "idle" && (message || state === "checking");

  return (
    <div
      aria-live="polite"
      style={{
        minHeight: "var(--space-4)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.3,
        color: tone,
        ...style,
      }}
      {...rest}
    >
      {showContent && (
        <>
          {state === "checking" && (
            <Spinner size={13} color="var(--text-tertiary)" label={message || "Checking"} />
          )}
          {state === "success" && <CheckIcon />}
          {state === "error" && <CrossIcon />}
          {message && <span>{message}</span>}
          {action && (
            <span style={{ display: "inline-flex", alignItems: "center" }}>{action}</span>
          )}
        </>
      )}
    </div>
  );
}
