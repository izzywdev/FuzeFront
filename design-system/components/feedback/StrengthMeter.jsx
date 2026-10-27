import React from "react";

const LEVELS = { empty: 0, weak: 1, fair: 2, good: 3, strong: 4 };

const TONES = {
  empty: "var(--text-tertiary)",
  weak: "var(--error-color)",
  fair: "var(--warning-color)",
  good: "var(--cyan-400)",
  strong: "var(--success-color)",
};

/**
 * Segmented strength meter — N bars lit to a `strength` level, tinted by tone,
 * with a caption row (`label` on the start, the `valueLabel` word on the end).
 * `children` render below the bars (e.g. a per-rule requirements checklist),
 * so the meter and its rules read as one unit.
 *
 * Purely presentational: the parent scores the value. The segmented bars are
 * decorative (`aria-hidden`); the caption row is a polite live region so the
 * level is announced as the user types. Tokens only; the bar order follows the
 * writing direction (logical grid), so it mirrors under RTL.
 */
export function StrengthMeter({
  strength = "empty",
  label,
  valueLabel,
  bars = 4,
  children,
  style,
  ...rest
}) {
  const level = Math.min(LEVELS[strength] ?? 0, bars);
  const tone = TONES[strength] ?? TONES.empty;
  return (
    <div
      data-strength={strength}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        marginBlockStart: "var(--space-3)",
        fontFamily: "var(--font-sans)",
        ...style,
      }}
      {...rest}
    >
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${bars}, 1fr)`,
          gap: "var(--space-1)",
        }}
      >
        {Array.from({ length: bars }, (_, i) => {
          const on = i < level;
          return (
            <span
              key={i}
              data-on={on ? "true" : "false"}
              style={{
                blockSize: "var(--space-1)",
                borderRadius: "var(--radius-pill)",
                background: on ? tone : "var(--bg-quaternary)",
                transition: "background var(--duration-base) var(--ease-standard)",
              }}
            />
          );
        })}
      </div>
      {(label || valueLabel) && (
        <div
          aria-live="polite"
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--space-2)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          <span>{label}</span>
          {valueLabel && (
            <b style={{ color: tone, fontWeight: "var(--weight-semibold)" }}>{valueLabel}</b>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
