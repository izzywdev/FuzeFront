import React from "react";

/**
 * Horizontal progress / usage meter — a labelled track + fill keyed to a
 * fraction of a limit. The runtime fabric uses it for usage-based billing
 * (seats, metered units) and quota displays. Token-only, RTL-safe (the fill
 * grows from the inline-start edge), accessible via role="progressbar".
 *
 * `tone` overrides the fill: default uses the fuse seam; near/over the limit
 * the consumer can pass "warning"/"danger" (e.g. >80% / >=100%).
 */
const TONE_FILL = {
  seam: "var(--seam)",
  warning: "var(--warning-color)",
  danger: "var(--error-color)",
};

export function ProgressMeter({
  value = 0,
  max = 100,
  label,
  valueLabel,
  tone = "seam",
  style,
  ...rest
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const fill = TONE_FILL[tone] || TONE_FILL.seam;

  return (
    <div style={{ fontFamily: "var(--font-sans)", ...style }} {...rest}>
      {(label || valueLabel) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "var(--space-2)",
            marginBlockEnd: "var(--space-2)",
          }}
        >
          {label && (
            <span
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
              }}
            >
              {label}
            </span>
          )}
          {valueLabel && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              {valueLabel}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeMax)}
        aria-label={label || "progress"}
        style={{
          position: "relative",
          inlineSize: "100%",
          blockSize: "8px",
          background: "var(--bg-quaternary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-pill)",
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            insetBlockStart: 0,
            insetInlineStart: 0,
            blockSize: "100%",
            inlineSize: `${pct}%`,
            background: fill,
            borderRadius: "var(--radius-pill)",
            transition: "inline-size var(--duration-base) var(--ease-standard)",
          }}
        />
      </div>
    </div>
  );
}
