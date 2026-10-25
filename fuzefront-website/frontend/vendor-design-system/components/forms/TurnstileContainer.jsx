import React from "react";
import { Spinner } from "../feedback/Spinner.jsx";

const Glyph = ({ tone }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" style={{ flex: "none" }}>
    <circle cx="13" cy="13" r="12" fill={tone === "success" ? "var(--success-soft)" : "var(--error-soft)"} />
    {tone === "success" ? (
      <path d="M8 13.5 11.5 17 18 9.5" stroke="var(--success-color)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M9 9l8 8M17 9l-8 8" stroke="var(--error-color)" strokeWidth="2" strokeLinecap="round" />
    )}
  </svg>
);

const BORDER = {
  verified: "var(--success-color)",
  failed: "var(--error-color)",
};

const DEFAULT_LABELS = {
  loading: "Loading challenge…",
  ready: "Complete the challenge",
  verified: "Verified — you're human",
  failed: "Verification failed",
  error: "Please complete the challenge to continue.",
  brand: "Cloudflare Turnstile",
};

/**
 * Shell for a managed anti-abuse challenge widget (Cloudflare Turnstile). The
 * design system owns the *chrome and states* — `loading` / `ready` / `verified`
 * / `failed` — and the feature owns the widget: pass it as `children` and it is
 * mounted in a slot that stays in the tree in EVERY state (a managed widget has
 * to keep running to mint/refresh its token).
 *
 * `failed` additionally surfaces `labels.error` as an `alert`. The state is
 * exposed as `data-state` on the root and on the status box. All visible copy
 * comes from `labels` so a caller can localize it; the vendor name is the one
 * deliberate, approved exception to the vendor-name rule (`labels.brand`).
 */
export function TurnstileContainer({
  state = "loading",
  labels,
  children,
  style,
  ...rest
}) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const text =
    state === "verified" ? <b style={{ color: "var(--success-color)", fontWeight: "var(--weight-medium)" }}>{L.verified}</b>
    : state === "failed" ? L.failed
    : state === "ready" ? L.ready
    : L.loading;
  return (
    <div
      data-state={state}
      style={{ marginBlock: "var(--space-5)", fontFamily: "var(--font-sans)", ...style }}
      {...rest}
    >
      <div
        data-state={state}
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          minBlockSize: "var(--space-16)",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--bg-secondary)",
          border: `1px solid ${BORDER[state] ?? "var(--border-color)"}`,
          borderRadius: "var(--radius-md)",
        }}
      >
        {state === "loading" && <Spinner size={20} label={L.loading} />}
        {state === "verified" && <Glyph tone="success" />}
        {state === "failed" && <Glyph tone="error" />}
        <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{text}</span>
        <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>{L.brand}</span>
      </div>
      {/* The vendor widget mounts here and is never unmounted between states. */}
      <div data-slot="widget">{children}</div>
      {state === "failed" && (
        <p
          role="alert"
          style={{
            margin: 0,
            marginBlockStart: "var(--space-2)",
            fontSize: "var(--text-sm)",
            color: "var(--error-color)",
          }}
        >
          {L.error}
        </p>
      )}
    </div>
  );
}
