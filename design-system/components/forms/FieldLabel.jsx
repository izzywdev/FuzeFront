import React from "react";

/**
 * Standalone form-field label — the same label treatment `Input`/`Select`
 * render internally, extracted for fields that don't go through those
 * primitives (a field wired through a form library's `register`, or a
 * custom edit/view toggle that swaps between a raw `<input>` and static
 * text). Wire it to its control via `htmlFor`/`id`, exactly like a native
 * `<label>`.
 *
 * `required` appends a tokenized asterisk plus a visually-hidden
 * " (required)" so the requirement reaches screen readers, not just sighted
 * users relying on the asterisk alone.
 */
export function FieldLabel({
  htmlFor,
  required = false,
  children,
  style,
  ...rest
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-secondary)",
        lineHeight: 1.2,
        marginBlockEnd: "var(--space-2)",
        ...style,
      }}
      {...rest}
    >
      {children}
      {required && (
        <>
          <span
            aria-hidden="true"
            style={{
              color: "var(--error-color)",
              marginInlineStart: "var(--space-1)",
            }}
          >
            *
          </span>
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
            {" (required)"}
          </span>
        </>
      )}
    </label>
  );
}
