import React from "react";

const ChevronIcon = ({ dir = "right" }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: dir === "left" ? "rotate(180deg)" : "none", flex: "none" }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function pageList(page, total) {
  if (total <= 6) return Array.from({ length: total }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, 4, "…", total];
  if (page >= total - 2) return [1, "…", total - 3, total - 2, total - 1, total];
  return [1, "…", page - 1, page, page + 1, "…", total];
}

const cellBase = {
  minWidth: 34,
  height: 34,
  padding: "0 8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-medium)",
  cursor: "pointer",
  transition: "background var(--duration-fast) var(--ease-standard)",
  lineHeight: 1,
};

/** Numbered pagination navigator — active page uses the accent fuse colour. */
export function Pagination({ page = 1, total = 10, onChange, style, ...rest }) {
  const pageCell = (content, opts = {}) => {
    const { active, disabled, onClick } = opts;
    return (
      <button
        disabled={disabled}
        onClick={onClick}
        style={{
          ...cellBase,
          background: active ? "var(--accent-color)" : "var(--bg-quaternary)",
          color: active ? "#fff" : "var(--text-secondary)",
          border: active ? "1px solid transparent" : "1px solid var(--border-color)",
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
        onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = "var(--bg-tertiary)"; }}
        onMouseLeave={(e) => { if (!disabled && !active) e.currentTarget.style.background = "var(--bg-quaternary)"; }}
      >
        {content}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center", ...style }} {...rest}>
      {pageCell(<ChevronIcon dir="left" />, {
        disabled: page <= 1,
        onClick: () => onChange && onChange(page - 1),
      })}
      {pageList(page, total).map((p, i) =>
        p === "…"
          ? <span key={"e" + i} style={{ color: "var(--text-tertiary)", padding: "0 4px", fontSize: "var(--text-sm)" }}>…</span>
          : <React.Fragment key={p}>{pageCell(p, { active: p === page, onClick: () => onChange && onChange(p) })}</React.Fragment>
      )}
      {pageCell(<ChevronIcon dir="right" />, {
        disabled: page >= total,
        onClick: () => onChange && onChange(page + 1),
      })}
    </div>
  );
}
