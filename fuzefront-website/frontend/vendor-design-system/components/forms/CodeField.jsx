import React from "react";

const WarningIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

/**
 * Monospace code/technical-value field — mirrors Textarea's label/error/focus
 * contract exactly, but renders `--font-mono` and never wraps letter-spacing
 * (tabular technical values: JSON blobs, ISO-8601 durations, TypeIDs,
 * remoteEntry URLs). Single-line by default (an `<input>`); pass `multiline`
 * for a JSON/code block (a `<textarea>`, vertical-resize only).
 */
export function CodeField({
  label,
  error = "",
  id,
  disabled = false,
  multiline = false,
  rows = 6,
  style,
  ...rest
}) {
  const hasError = Boolean(error);
  const baseBorder = hasError ? "var(--error-color)" : "var(--border-color)";
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const Tag = multiline ? "textarea" : "input";

  const fieldStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "var(--space-3) var(--space-3)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    fontWeight: "var(--weight-regular)",
    lineHeight: 1.5,
    color: "var(--text-primary)",
    background: "var(--bg-secondary)",
    border: `1px solid ${baseBorder}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "text",
    ...(multiline ? { resize: "vertical" } : {}),
    transition:
      "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard)",
    ...style,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        width: "100%",
      }}
    >
      {label && (
        <label
          htmlFor={fieldId}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-secondary)",
            lineHeight: 1.2,
          }}
        >
          {label}
        </label>
      )}
      <Tag
        id={fieldId}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        {...(multiline ? { rows } : {})}
        style={fieldStyle}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = hasError
            ? "var(--error-color)"
            : "var(--accent-color)";
          e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
          if (rest.onFocus) rest.onFocus(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = baseBorder;
          e.currentTarget.style.boxShadow = "none";
          if (rest.onBlur) rest.onBlur(e);
        }}
        {...rest}
      />
      {hasError && (
        <span
          role="alert"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--error-color)",
            lineHeight: 1.3,
          }}
        >
          <WarningIcon />
          {error}
        </span>
      )}
    </div>
  );
}
