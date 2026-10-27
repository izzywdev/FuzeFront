import React from "react";
import { DEFAULT_PASSWORD_RULES } from "./PasswordChecklist.jsx";

const LEVELS = ["empty", "weak", "fair", "good", "strong"];
const LEVEL_COLOR = {
  weak: "var(--error-color)",
  fair: "var(--warning-color)",
  good: "var(--success-color)",
  strong: "var(--success-color)",
};

/**
 * Strength level (0-4) for a password: the share of policy `rules` it meets,
 * bucketed into empty / weak / fair / good / strong. Pure — shared with callers
 * that want to gate on it.
 */
export function passwordStrength(value, rules = DEFAULT_PASSWORD_RULES) {
  const v = value || "";
  if (!v) return 0;
  const met = rules.filter((r) => r.test(v)).length;
  const ratio = rules.length === 0 ? 1 : met / rules.length;
  if (ratio >= 1) return 4;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.4) return 2;
  return 1;
}

/**
 * Segmented password-strength bar (4 segments) driven by the same policy rules
 * as `PasswordChecklist`. Exposes `data-meter="<level>"` and an accessible
 * `role="meter"` reading. Purely presentational; tokens only.
 */
export function PasswordStrengthMeter({
  value = "",
  rules = DEFAULT_PASSWORD_RULES,
  labels = { empty: "", weak: "Weak", fair: "Fair", good: "Good", strong: "Strong" },
  label = "Password strength",
  style,
  ...rest
}) {
  const score = passwordStrength(value, rules);
  const level = LEVELS[score];
  const color = LEVEL_COLOR[level];
  return (
    <div
      data-meter={level}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={score}
      aria-valuetext={labels[level] || undefined}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", ...style }}
      {...rest}
    >
      <div style={{ display: "flex", gap: "var(--space-1)" }} aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            data-on={n <= score ? "true" : "false"}
            style={{
              flex: 1,
              height: "var(--space-1)",
              borderRadius: "var(--radius-pill)",
              background: n <= score ? color : "var(--bg-quaternary, var(--border-color))",
              transition: "background var(--duration-base) var(--ease-standard)",
            }}
          />
        ))}
      </div>
      {labels[level] && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
          }}
        >
          {labels[level]}
        </span>
      )}
    </div>
  );
}

// Pure helper surfaced as a static so feature code reaches it through the barrel.
PasswordStrengthMeter.strength = passwordStrength;
