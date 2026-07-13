import React from "react";

/**
 * Toggle switch — replaces the Tailwind `sr-only peer` checkbox + pseudo-element
 * track pattern. Pure inline-style implementation with a visually-hidden input.
 */
export function Toggle({
  checked = false,
  onChange,
  disabled = false,
  label,
  id,
  style,
  ...rest
}) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;

  const trackColor = checked
    ? (disabled ? "var(--accent-soft)" : "var(--accent-color)")
    : "var(--bg-quaternary)";

  return (
    <label
      htmlFor={fieldId}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        gap: "var(--space-2)",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
      {...rest}
    >
      {/* visually hidden checkbox */}
      <input
        type="checkbox"
        id={fieldId}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          borderWidth: 0,
        }}
      />
      {/* track */}
      <span
        style={{
          position: "relative",
          display: "inline-block",
          width: "44px",
          height: "24px",
          background: trackColor,
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-pill)",
          transition: "background var(--duration-base) var(--ease-standard)",
          flexShrink: 0,
        }}
      >
        {/* thumb */}
        <span
          style={{
            position: "absolute",
            top: "2px",
            insetInlineStart: checked ? "22px" : "2px",
            width: "18px",
            height: "18px",
            background: "#fff",
            borderRadius: "50%",
            boxShadow: "var(--shadow-md)",
            transition: "inset-inline-start var(--duration-base) var(--ease-standard)",
          }}
        />
      </span>
      {label && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
          {label}
        </span>
      )}
    </label>
  );
}
