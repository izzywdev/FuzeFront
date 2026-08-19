import React from "react";

const ChevronDown = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const WarningIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

/**
 * Labeled dropdown for the shell's forms and config dialogs — surface, border,
 * radius and focus match Input. Focus lights the "fuse seam" accent; `error`
 * borders red and surfaces the message. The native chevron is replaced with a
 * tokenized one so the control reads consistently on the dark shell.
 *
 * RTL: spacing and the chevron use CSS *logical* properties (padding-inline,
 * inset-inline-end, text-align: start) so the control mirrors automatically
 * under `dir="rtl"` — no per-direction branching. The platform's direction
 * manager (@fuzefront/i18n) owns the `<html dir>` flip.
 */
export function Select({
  label,
  options = [],
  placeholder,
  error = "",
  id,
  disabled = false,
  children,
  style,
  ...rest
}) {
  const hasError = Boolean(error);
  const baseBorder = hasError ? "var(--error-color)" : "var(--border-color)";
  // Always associate the label with the control (see Input.jsx).
  const reactId = React.useId();
  const fieldId = id ?? reactId;

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
      <div style={{ position: "relative", width: "100%" }}>
        <select
          id={fieldId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          style={{
            width: "100%",
            boxSizing: "border-box",
            // Logical spacing: extra inline-end room for the chevron, mirrors in RTL.
            paddingBlock: "var(--space-3)",
            paddingInlineStart: "var(--space-3)",
            paddingInlineEnd: "calc(var(--space-3) + var(--space-6))",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-regular)",
            lineHeight: 1.4,
            color: "var(--text-primary)",
            background: "var(--bg-secondary)",
            border: `1px solid ${baseBorder}`,
            borderRadius: "var(--radius-md)",
            outline: "none",
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
            textAlign: "start",
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
            transition:
              "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard), background var(--duration-base) var(--ease-standard)",
            ...style,
          }}
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
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            // Logical inline-end so the chevron sits on the trailing edge in RTL too.
            insetInlineEnd: "var(--space-3)",
            top: "50%",
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            color: "var(--text-tertiary)",
            pointerEvents: "none",
          }}
        >
          <ChevronDown />
        </span>
      </div>
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
