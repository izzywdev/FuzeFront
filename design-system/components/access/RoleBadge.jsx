import React from "react";

const Crown = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z" />
  </svg>
);

const Shield = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
  </svg>
);

const User = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </svg>
);

const Eye = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

// Each role maps to a tone: a foreground color, a tinted background, and a
// soft border drawn from the same hue. owner=amber spark, admin=the indigo
// fuse, member=cyan signal, viewer=cool neutral.
const ROLES = {
  owner: {
    label: "Owner",
    color: "var(--warning-color)",
    background: "rgba(245, 166, 35, 0.14)",
    border: "rgba(245, 166, 35, 0.32)",
    Icon: Crown,
  },
  admin: {
    label: "Admin",
    color: "var(--accent-color)",
    background: "var(--accent-soft)",
    border: "rgba(110, 92, 255, 0.34)",
    Icon: Shield,
  },
  member: {
    label: "Member",
    color: "var(--accent-2)",
    background: "rgba(41, 211, 230, 0.12)",
    border: "rgba(41, 211, 230, 0.30)",
    Icon: User,
  },
  viewer: {
    label: "Viewer",
    color: "var(--text-tertiary)",
    background: "var(--bg-quaternary)",
    border: "var(--border-color)",
    Icon: Eye,
  },
};

/**
 * Role pill for org membership — a tinted, icon-led label whose tone
 * encodes the member's authority within an organization.
 */
export function RoleBadge({
  role = "member",
  showIcon = true,
  style,
  ...rest
}) {
  const r = ROLES[role] || ROLES.member;
  const Icon = r.Icon;
  return (
    <span
      title={r.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "3px 10px 3px 8px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: r.color,
        background: r.background,
        border: `1px solid ${r.border}`,
        borderRadius: "var(--radius-pill)",
        ...style,
      }}
      {...rest}
    >
      {showIcon && <Icon size={12} />}
      {r.label}
    </span>
  );
}
