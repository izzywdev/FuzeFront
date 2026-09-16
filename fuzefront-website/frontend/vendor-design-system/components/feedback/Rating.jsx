import React from "react";

const StarIcon = ({ size = 14 }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"
    style={{ width: size, height: size, flex: "none" }}>
    <path d="M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1z" />
  </svg>
);

function Stars({ value, count, size }) {
  return (
    <span style={{ display: "inline-flex", gap: "2px", alignItems: "center" }}>
      {Array.from({ length: count }, (_, i) => {
        const filled = value >= i + 1;
        const half = !filled && value >= i + 0.5;
        return (
          <span key={i} style={{ color: filled || half ? "var(--warning-color)" : "var(--border-color)", opacity: half ? 0.6 : 1 }}>
            <StarIcon size={size} />
          </span>
        );
      })}
    </span>
  );
}

/**
 * Star rating display component.
 * - `variant="row"` — inline stars + score (default).
 * - `variant="pill"` — compact rounded badge with all 5 stars + score + review count.
 */
export function Rating({ value = 0, count, variant = "row", starCount = 5, style, ...rest }) {
  const size = variant === "pill" ? 13 : 14;

  if (variant === "pill") {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "var(--bg-quaternary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-pill)",
          padding: "4px 10px",
          fontSize: "var(--text-xs)",
          ...style,
        }}
        {...rest}
      >
        <Stars value={value} count={starCount} size={size} />
        <strong style={{ color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>{value}</strong>
        {count !== undefined && (
          <span style={{ color: "var(--text-tertiary)" }}>· {count.toLocaleString()} reviews</span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "var(--text-sm)",
        color: "var(--text-secondary)",
        ...style,
      }}
      {...rest}
    >
      <Stars value={value} count={starCount} size={size} />
      <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>{value}</span>
      {count !== undefined && (
        <span style={{ color: "var(--text-tertiary)" }}>({count.toLocaleString()})</span>
      )}
    </div>
  );
}
