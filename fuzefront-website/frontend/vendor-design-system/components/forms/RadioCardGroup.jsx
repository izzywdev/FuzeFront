import React from "react";

// One injected <style> block for every instance (same pattern as Container /
// Spinner): identical content is trivially deduped by the browser and this
// package has no CSS bundle of its own. Every value is a design token; every
// inline-axis rule is a logical property, so the cards mirror under dir="rtl"
// with no extra work.
const CSS = `
  .ds-rcg {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    border: 0;
    min-inline-size: 0;
  }
  .ds-rcg__opt {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
    box-sizing: border-box;
    min-block-size: var(--touch-target);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-secondary);
    border: var(--border-width) solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-md);
    text-align: start;
    cursor: pointer;
  }
  .ds-rcg__opt:focus-visible {
    outline: var(--border-width-strong) solid var(--accent-color);
    outline-offset: 2px;
    border-radius: var(--radius-md);
  }
  .ds-rcg__opt[aria-checked='true'] {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 var(--border-width) var(--accent-color);
  }
  .ds-rcg__opt[data-pending='true'] {
    border-style: dashed;
    border-color: var(--accent-color);
  }
  .ds-rcg__opt[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ds-rcg__radio {
    box-sizing: border-box;
    inline-size: var(--space-4);
    block-size: var(--space-4);
    margin-block-start: calc(var(--space-1) / 2);
    border: var(--border-width-strong) solid var(--border-strong);
    border-radius: var(--radius-pill);
  }
  .ds-rcg__opt[aria-checked='true'] .ds-rcg__radio {
    border-color: var(--accent-color);
    background: radial-gradient(var(--accent-color) 40%, transparent 45%);
  }
  .ds-rcg__title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
  }
  .ds-rcg__desc {
    margin: var(--space-1) 0 0;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }
  @media (forced-colors: active) {
    .ds-rcg__opt[aria-checked='true'] { border-color: Highlight; }
    .ds-rcg__opt[aria-checked='true'] .ds-rcg__radio {
      border-color: Highlight;
      background: radial-gradient(Highlight 40%, transparent 45%);
    }
  }
`;

function isRtl(el) {
  const dirAncestor = el.closest("[dir]");
  const attr = dirAncestor && dirAncestor.getAttribute("dir");
  if (attr === "rtl") return true;
  if (attr === "ltr") return false;
  return typeof getComputedStyle === "function" && getComputedStyle(el).direction === "rtl";
}

/**
 * RadioCardGroup — a radio group rendered as selectable cards, each with a
 * title (`label`) and an optional supporting `description`. Built for
 * "who can see this?" style choices where every option needs a sentence of
 * explanation (the selection-lists fork dialog and visibility control).
 *
 * Semantics follow the WAI-ARIA radio group pattern: the container is a
 * `role="radiogroup"`, each card a `role="radio"` with `aria-checked`, and
 * focus is roving — only the selected (or first enabled) card is in the tab
 * order, and the arrow keys move focus *and* selection to the next enabled
 * card, skipping disabled ones. Space selects the focused card. Left/Right
 * flip under `dir="rtl"`; Up/Down never do.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
 */
export function RadioCardGroup({
  options = [],
  value,
  defaultValue,
  onChange,
  disabled = false,
  name,
  ariaLabel,
  ariaLabelledBy,
  style,
  ref,
  ...rest
}) {
  const baseId = React.useId();
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue);
  const current = isControlled ? value : inner;

  const groupRef = React.useRef(null);
  const cardRefs = React.useRef([]);
  const setGroupRef = React.useCallback(
    (node) => {
      groupRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const enabled = (opt) => !disabled && !opt.disabled;

  const select = (opt) => {
    if (!enabled(opt)) return;
    if (!isControlled) setInner(opt.value);
    if (opt.value !== current && onChange) onChange(opt.value);
  };

  const enabledIndexes = options.reduce((acc, opt, i) => (enabled(opt) ? [...acc, i] : acc), []);
  const checkedIndex = options.findIndex((opt) => opt.value === current);
  // Roving tab stop: the checked card when it is enabled, else the first enabled card.
  const tabStop =
    checkedIndex >= 0 && enabledIndexes.includes(checkedIndex) ? checkedIndex : enabledIndexes[0];

  const move = (from, step) => {
    if (enabledIndexes.length === 0) return;
    const pos = enabledIndexes.indexOf(from);
    const nextPos =
      pos === -1
        ? step > 0 ? 0 : enabledIndexes.length - 1
        : (pos + step + enabledIndexes.length) % enabledIndexes.length;
    const target = enabledIndexes[nextPos];
    const node = cardRefs.current[target];
    if (node) node.focus();
    select(options[target]);
  };

  const onKeyDown = (event, index) => {
    if (event.defaultPrevented) return;
    let step = 0;
    switch (event.key) {
      case "ArrowDown":
        step = 1;
        break;
      case "ArrowUp":
        step = -1;
        break;
      case "ArrowRight":
        step = isRtl(event.currentTarget) ? -1 : 1;
        break;
      case "ArrowLeft":
        step = isRtl(event.currentTarget) ? 1 : -1;
        break;
      case " ":
        event.preventDefault();
        select(options[index]);
        return;
      default:
        return;
    }
    event.preventDefault();
    move(index, step);
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        ref={setGroupRef}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-disabled={disabled ? "true" : undefined}
        data-radio-card-group=""
        className="ds-rcg"
        style={style}
        {...rest}
      >
        {options.map((opt, index) => {
          const {
            value: optValue,
            label,
            description,
            disabled: _disabled,
            pending = false,
            ...optRest
          } = opt;
          const checked = optValue === current;
          const isDisabled = !enabled(opt);
          const titleId = `${baseId}-t${index}`;
          const descId = `${baseId}-d${index}`;
          const describedBy =
            [description != null ? descId : null, optRest["aria-describedby"]]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <div
              {...optRest}
              key={String(optValue)}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              role="radio"
              aria-checked={checked}
              aria-disabled={isDisabled ? "true" : undefined}
              aria-labelledby={titleId}
              aria-describedby={describedBy}
              tabIndex={index === tabStop ? 0 : -1}
              data-value={String(optValue)}
              data-pending={pending ? "true" : undefined}
              className="ds-rcg__opt"
              onClick={(e) => {
                if (optRest.onClick) optRest.onClick(e);
                if (!e.defaultPrevented) select(opt);
              }}
              onKeyDown={(e) => {
                if (optRest.onKeyDown) optRest.onKeyDown(e);
                onKeyDown(e, index);
              }}
            >
              <span className="ds-rcg__radio" aria-hidden="true" />
              <div>
                <div className="ds-rcg__title" id={titleId}>
                  {label}
                </div>
                {description != null && (
                  <p className="ds-rcg__desc" id={descId}>
                    {description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {name != null && current !== undefined && (
          <input type="hidden" name={name} value={String(current)} />
        )}
      </div>
    </>
  );
}
