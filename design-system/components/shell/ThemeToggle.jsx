import React from "react";

const Sun = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const Moon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: "none" }}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/**
 * Icon button that toggles the host shell between dark and light themes by
 * flipping document data-theme. Reads as a quiet IconButton; shows a moon
 * while dark (tap for light) and a sun while light (tap for dark).
 */
export function ThemeToggle({
  theme = "dark",
  onToggle,
  style,
  ...rest
}) {
  const isDark = theme === "dark";
  const next = isDark ? "light" : "dark";

  const handleClick = (e) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    if (onToggle) onToggle(next, e);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "36px",
        height: "36px",
        padding: 0,
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: "var(--radius-md)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        transition:
          "background-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-quaternary)";
        e.currentTarget.style.color = "var(--text-primary)";
        e.currentTarget.style.borderColor = "var(--border-color)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-secondary)";
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.92)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {isDark ? <Moon /> : <Sun />}
    </button>
  );
}
