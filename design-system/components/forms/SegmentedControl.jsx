import React from "react";

// One injected <style> block for every instance (same pattern as Container /
// Spinner). Tokens only; inline-axis rules are logical properties so the
// separators and the rounded ends mirror under dir="rtl".
const CSS = `
  .ds-seg {
    display: inline-flex;
    max-inline-size: 100%;
    box-sizing: border-box;
    border: var(--border-width) solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .ds-seg__opt {
    appearance: none;
    box-sizing: border-box;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    cursor: pointer;
  }
  .ds-seg__opt + .ds-seg__opt {
    border-inline-start: var(--border-width) solid var(--border-color);
  }
  .ds-seg__opt[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--text-primary);
  }
  .ds-seg__opt:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* The group clips its rounded corners, so the ring is drawn INSIDE the
     segment — an outset outline would be cut off by overflow: hidden. */
  .ds-seg__opt:focus-visible {
    outline: var(--border-width-strong) solid var(--accent-color);
    outline-offset: calc(var(--border-width-strong) * -1);
    border-radius: 0;
  }
  /* Touch devices and the xs breakpoint (< 480px): 44px tap targets. */
  @media (max-width: 479px), (pointer: coarse) {
    .ds-seg__opt {
      min-block-size: var(--touch-target);
      min-inline-size: var(--touch-target);
    }
  }
  @media (forced-colors: active) {
    .ds-seg__opt[aria-pressed='true'] { outline: var(--border-width-strong) solid Highlight; outline-offset: calc(var(--border-width-strong) * -1); }
  }
`;

/**
 * SegmentedControl — a compact single-select button group for filtering or
 * switching a view (Any / Private / Organization / Common). Every segment is a
 * real `<button>` carrying `aria-pressed`; exactly one is pressed at a time
 * and pressing the pressed segment is a no-op (a segmented control cannot be
 * cleared — add an explicit "Any" segment for that). Each segment is its own
 * tab stop, Space/Enter activate it.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
 */
export function SegmentedControl({
  options = [],
  value,
  defaultValue,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  style,
  ref,
  ...rest
}) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue);
  const current = isControlled ? value : inner;

  const select = (opt) => {
    if (disabled || opt.disabled || opt.value === current) return;
    if (!isControlled) setInner(opt.value);
    if (onChange) onChange(opt.value);
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={ref}
        role="group"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-segmented-control=""
        className="ds-seg"
        style={style}
        {...rest}
      >
        {options.map((opt) => {
          const { value: optValue, label, disabled: optDisabled = false, ...optRest } = opt;
          return (
            <button
              {...optRest}
              key={String(optValue)}
              type="button"
              aria-pressed={optValue === current}
              disabled={disabled || optDisabled}
              data-value={String(optValue)}
              className="ds-seg__opt"
              onClick={(e) => {
                if (optRest.onClick) optRest.onClick(e);
                if (!e.defaultPrevented) select(opt);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}
