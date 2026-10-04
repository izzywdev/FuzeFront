import React from "react";

/**
 * Accessible tab strip — a horizontal `role="tablist"` of buttons. Controlled:
 * the consumer owns the active value and switches on `onChange`. Use it to
 * navigate sub-views within an area (e.g. Billing → Plans / Invoices /
 * Payments). The active tab carries `aria-selected` + a seam-accent underline
 * so the signal is not color-only.
 *
 * Keyboard: Left/Right (and Home/End) move focus+selection across tabs, per the
 * WAI-ARIA tabs pattern (automatic activation).
 */
export function Tabs({ tabs = [], value, onChange, ariaLabel, style, ...rest }) {
  const refs = React.useRef([]);

  const focusTab = (index) => {
    const tab = tabs[index];
    if (!tab) return;
    refs.current[index]?.focus();
    if (onChange && tab.value !== value) onChange(tab.value);
  };

  const onKeyDown = (e, index) => {
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      focusTab(next);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: "var(--space-1)",
        borderBottom: "var(--border-width) solid var(--border-color)",
        ...style,
      }}
      {...rest}
    >
      {tabs.map((tab, i) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            id={tab.id || `tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={tab.controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange && onChange(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              borderBottom:
                "var(--border-width-strong) solid " +
                (selected ? "var(--accent-color)" : "transparent"),
              marginBottom: "calc(-1 * var(--border-width))",
              padding: "var(--space-3) var(--space-4)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: selected ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color var(--duration-fast) var(--ease-standard)",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
