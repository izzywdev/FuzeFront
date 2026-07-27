import React from "react";

// Status key -> semantic tone + default label. Mirrors StatusPage.tsx (service
// health) AND the portal lifecycle / domain / Connect-onboarding vocabulary
// commissioned by design/frames/portal-admin-consoles (active/suspended/
// pending/restricted, verified/enabled/disabled, in-progress/not-started,
// invited/expired). `online`/`degraded`/`offline` are kept for back-compat
// with existing service-health consumers.
const STATUSES = {
  online: { tone: "success", label: "Online" },
  active: { tone: "success", label: "Active" },
  verified: { tone: "success", label: "Verified" },
  enabled: { tone: "success", label: "Enabled" },

  degraded: { tone: "warning", label: "Degraded" },
  pending: { tone: "warning", label: "Pending" },
  "in-progress": { tone: "warning", label: "In progress" },
  invited: { tone: "warning", label: "Invited" },

  offline: { tone: "error", label: "Offline" },
  suspended: { tone: "error", label: "Suspended" },
  restricted: { tone: "error", label: "Restricted" },
  expired: { tone: "error", label: "Expired" },

  disabled: { tone: "neutral", label: "Disabled" },
  "not-started": { tone: "neutral", label: "Not started" },
};

const TONES = {
  success: { color: "var(--success-color)", background: "var(--success-soft)" },
  warning: { color: "var(--warning-color)", background: "var(--warning-soft)" },
  error: { color: "var(--error-color)", background: "var(--error-soft)" },
  neutral: { color: "var(--text-secondary)", background: "var(--bg-quaternary)" },
};

/**
 * Semantic lifecycle status pill — a colored dot + label keyed to a fixed
 * vocabulary of statuses (service health, portal lifecycle, domain
 * verification, invite/Connect-onboarding state). Background is a soft tint
 * of the status color (not color-only: paired with the dot + text label).
 */
export function StatusPill({
  status = "online",
  label,
  style,
  ...rest
}) {
  const s = STATUSES[status] || STATUSES.online;
  const t = TONES[s.tone] || TONES.success;
  const text = label != null ? label : s.label;
  return (
    <span
      role="status"
      aria-label={text}
      data-status={status}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "2px var(--space-3)",
        background: t.background,
        color: t.color,
        border: "1px solid transparent",
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: "6px",
          height: "6px",
          borderRadius: "var(--radius-pill)",
          background: "currentColor",
        }}
      />
      {text}
    </span>
  );
}
