import React from "react";

const SearchIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Filter/search input for scannable lists (directories, tables) — a leading
 * search glyph inside a bordered field, matching Input's surface/focus
 * treatment. `label` is visually hidden by default (the placeholder carries
 * the visible hint); pass `hideLabel={false}` to show it above the field.
 *
 * RTL: the icon/gap use `gap`, and the input's `text-align` follows the
 * inherited writing direction — no per-direction branching needed.
 */
export function SearchField({
  label = "Search",
  hideLabel = true,
  id,
  placeholder = "Search…",
  style,
  inputStyle,
  onFocus,
  onBlur,
  ...rest
}) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const [focused, setFocused] = React.useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%", ...style }}>
      <label htmlFor={fieldId} style={hideLabel ? visuallyHidden : {
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-secondary)",
      }}>
        {label}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          padding: "var(--space-2) var(--space-3)",
          background: "var(--bg-primary)",
          border: `1px solid ${focused ? "var(--accent-color)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-md)",
          boxShadow: focused ? "0 0 0 3px var(--accent-soft)" : "none",
          transition:
            "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
        }}
      >
        <span style={{ color: "var(--text-tertiary)", display: "grid", placeItems: "center" }}>
          <SearchIcon />
        </span>
        <input
          id={fieldId}
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          onFocus={(e) => {
            setFocused(true);
            if (onFocus) onFocus(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            if (onBlur) onBlur(e);
          }}
          style={{
            flex: 1,
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            ...inputStyle,
          }}
          {...rest}
        />
      </div>
    </div>
  );
}
