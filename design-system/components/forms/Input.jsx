import React from "react";

const WarningIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
);

const EyeIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }} aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }} aria-hidden="true">
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

/**
 * Labeled text field for the shell's forms and config dialogs. Focus lights the
 * "fuse seam" accent; the error state borders red and surfaces the message.
 *
 * Password fields (`type="password"`) automatically get a show/hide reveal
 * toggle (an eye button) inside the field. Pass `revealToggle={false}` to opt
 * out. The toggle only swaps the input's `type` locally — the bound `value`
 * (React state) is never touched, so a controlled password field keeps working.
 */
export function Input({
  label,
  error = "",
  id,
  type,
  disabled = false,
  revealToggle = true,
  style,
  ...rest
}) {
  const hasError = Boolean(error);
  const baseBorder = hasError ? "var(--error-color)" : "var(--border-color)";
  // Always associate the label with the control: fall back to a generated id
  // when the consumer doesn't pass one, so the field is reachable by its label
  // (accessibility + testing-library getByLabelText).
  const reactId = React.useId();
  const fieldId = id ?? reactId;

  const [revealed, setRevealed] = React.useState(false);
  const isPassword = type === "password";
  const showToggle = isPassword && revealToggle && !disabled;
  // When revealed, render as a text input so the value is visible; the bound
  // `value`/`onChange` are unchanged, so this is purely a display swap.
  const effectiveType = isPassword && revealed ? "text" : type;

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
      <div style={{ position: "relative", display: "flex", width: "100%" }}>
        <input
          id={fieldId}
          type={effectiveType}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "var(--space-3) var(--space-3)",
            // Clear room for the reveal button so text never runs under it.
            paddingInlineEnd: showToggle ? "var(--space-10)" : undefined,
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
            cursor: disabled ? "not-allowed" : "text",
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
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            // Keep focus on the field: a mousedown on the button would otherwise
            // blur the input (losing the focus ring) before the click fires.
            onMouseDown={(e) => e.preventDefault()}
            // Accessible name comes from the visually-hidden <span> below, NOT an
            // aria-label: an aria-label of "Show password" is also matched by
            // Testing Library's getByLabelText(/password/i), so it collided with
            // the password field itself in consumer tests. Text content gives the
            // same accessible name (getByRole name) without that false match.
            aria-pressed={revealed}
            aria-controls={fieldId}
            title={revealed ? "Hide password" : "Show password"}
            style={{
              position: "absolute",
              insetBlockStart: "50%",
              insetInlineEnd: "var(--space-3)",
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              lineHeight: 0,
              borderRadius: "var(--radius-sm)",
              transition: "color var(--duration-base) var(--ease-standard)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            onFocus={(e) => {
              e.currentTarget.style.color = "var(--accent-color)";
              e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <span
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: 0,
                margin: "-1px",
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {revealed ? "Hide password" : "Show password"}
            </span>
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
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
