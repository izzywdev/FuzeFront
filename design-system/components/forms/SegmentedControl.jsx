import React from "react";

/**
 * Segmented control — a compact 2-3 option toggle for choosing ONE value from a
 * short, mutually-exclusive set (invitee kind, delivery channel, member type).
 * Each segment is a real `<button type="button">` carrying `aria-pressed`, the
 * selected one is also marked with an accent fill AND a `data-selected` hook, so
 * the selection is never color-only.
 *
 * Controlled: the consumer owns `value` and switches on `onChange`.
 *
 * Keyboard: Left/Right (and Home/End) move focus between segments. Direction is
 * read from the computed `direction` of the control so the arrows follow the
 * visual order under RTL. Selection is committed with Enter/Space (native button
 * activation) — focus movement alone never changes the value.
 *
 * Layout uses CSS logical properties only, so it mirrors under `dir="rtl"`.
 * `disabled` on the control inerts every segment (`aria-disabled="true"` on the
 * group); a per-option `disabled` inerts just that segment.
 */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel,
  disabled = false,
  fullWidth = true,
  style,
  ...rest
}) {
  const refs = React.useRef([]);

  const moveFocus = (from, step, e) => {
    const enabled = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.disabled && !disabled);
    if (enabled.length === 0) return;
    const pos = enabled.findIndex(({ i }) => i === from);
    const next = enabled[(pos + step + enabled.length) % enabled.length];
    e.preventDefault();
    refs.current[next.i]?.focus();
  };

  const onKeyDown = (e, index) => {
    const rtl =
      typeof getComputedStyle === "function" &&
      getComputedStyle(e.currentTarget).direction === "rtl";
    if (e.key === "ArrowRight") moveFocus(index, rtl ? -1 : 1, e);
    else if (e.key === "ArrowLeft") moveFocus(index, rtl ? 1 : -1, e);
    else if (e.key === "Home") {
      const first = options.findIndex((o) => !o.disabled);
      if (first >= 0) { e.preventDefault(); refs.current[first]?.focus(); }
    } else if (e.key === "End") {
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i].disabled) { e.preventDefault(); refs.current[i]?.focus(); break; }
      }
    }
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        gap: "var(--space-1)",
        padding: "var(--space-1)",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
      {...rest}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        const inert = disabled || opt.disabled;
        return (
          <button
            key={opt.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            data-option={opt.value}
            data-selected={selected ? "true" : "false"}
            aria-pressed={selected}
            disabled={inert}
            onClick={() => { if (!inert && !selected && onChange) onChange(opt.value); }}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              flex: fullWidth ? 1 : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-2)",
              padding: "var(--space-2) var(--space-3)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              lineHeight: 1.2,
              color: selected ? "var(--text-primary)" : "var(--text-secondary)",
              background: selected ? "var(--accent-soft)" : "transparent",
              border: "1px solid " + (selected ? "var(--accent-color)" : "transparent"),
              borderRadius: "var(--radius-sm)",
              cursor: inert ? "not-allowed" : "pointer",
              opacity: opt.disabled && !disabled ? 0.5 : 1,
              whiteSpace: "nowrap",
              transition:
                "background var(--duration-base) var(--ease-standard), border-color var(--duration-base) var(--ease-standard), color var(--duration-base) var(--ease-standard)",
            }}
          >
            {opt.icon ? <span aria-hidden="true" style={{ display: "inline-flex" }}>{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
