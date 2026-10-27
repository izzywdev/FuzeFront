import React from "react";
import { Textarea } from "./Textarea.jsx";

// Visually hidden but still read by assistive tech (same technique as the
// password-reveal label in Input.jsx). Every value here is intentionally a
// literal: this is the standard 1px clip, not a design value.
const SR_ONLY = {
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

/** Length in Unicode code points — what OpenAPI/JSON-Schema `maxLength` counts. */
function codePointLength(text) {
  let n = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of text) n += 1;
  return n;
}

/**
 * Slice `text` to at most `max` Unicode code points. Unlike the native
 * `maxlength` attribute (which counts UTF-16 code units and so cuts an emoji
 * off at one surrogate half), this counts the same code points the counter
 * shows, so a `max`-code-point value is always reachable.
 */
function sliceToCodePoints(text, max) {
  let n = 0;
  let end = 0;
  for (const ch of text) {
    if (n >= max) break;
    n += 1;
    end += ch.length;
  }
  return n >= max ? text.slice(0, end) : text;
}

function defaultFormatMessage({ remaining, over, max }, fmt) {
  if (over) {
    const by = fmt(-remaining);
    return `${by} ${-remaining === 1 ? "character" : "characters"} over the limit of ${fmt(max)}`;
  }
  return `${fmt(remaining)} of ${fmt(max)} ${max === 1 ? "character" : "characters"} remaining`;
}

function defaultOverLimitMessage(max, fmt) {
  return `Too long — the limit is ${fmt(max)} characters`;
}

/**
 * TextareaWithCounter — a `Textarea` with a live character counter and a limit.
 * Built for length-limited free text (a brief ≤ 4000, notes or a reason ≤ 2000).
 *
 * - The counter sits on the label row at the inline-end edge (mirrors in RTL),
 *   set in mono with tabular figures, and turns to the error colour when over.
 * - **Soft limit by default**: the user may type or paste past `maxLength`; the
 *   counter and field flag the overflow and the form can block submit. Pass
 *   `strict` to truncate input to `maxLength` code points (the native
 *   `maxlength` attribute is not used — it counts UTF-16 units and would cut an
 *   emoji off mid-surrogate, making the advertised limit unreachable).
 * - Length is counted in Unicode code points (what an OpenAPI `maxLength`
 *   counts), so an emoji is one character, not two.
 * - Accessible: the visible counter is `aria-hidden`; the field is described by
 *   a visually-hidden "N of M characters remaining" message (read on focus), and
 *   a debounced `aria-live="polite"` region announces changes after the user
 *   pauses typing, instead of on every keystroke. Over the limit the field gets
 *   `aria-invalid` and a stable (non-keystroke-varying) error message.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). All other
 * props (`label`, `rows`, `error`, `disabled`, `placeholder`, `name`…) go to
 * `Textarea`. A caller-supplied `error` always wins over the built-in
 * over-limit message.
 */
export function TextareaWithCounter({
  maxLength,
  strict = false,
  value,
  defaultValue,
  onChange,
  error,
  locale,
  formatMessage,
  overLimitMessage,
  announceDelay = 1000,
  counterProps,
  "aria-describedby": ariaDescribedBy,
  ...rest
}) {
  const baseId = React.useId();
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const text = String(isControlled ? value ?? "" : inner);

  const fmt = React.useMemo(() => {
    const nf = new Intl.NumberFormat(locale);
    return (n) => nf.format(n);
  }, [locale]);

  const count = codePointLength(text);
  const max = maxLength;
  const remaining = max - count;
  const over = remaining < 0;
  const state = { count, max, remaining, over };
  const message = formatMessage ? formatMessage(state) : defaultFormatMessage(state, fmt);

  // Debounced live announcement. The first render never announces (a live
  // region that is populated on mount is not read, and we want silence until
  // the user actually edits).
  const [announced, setAnnounced] = React.useState("");
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    if (!announceDelay) {
      setAnnounced(message);
      return undefined;
    }
    const t = setTimeout(() => setAnnounced(message), announceDelay);
    return () => clearTimeout(t);
  }, [message, announceDelay]);

  const handleChange = (e) => {
    let next = e.target.value;
    if (strict && max != null && codePointLength(next) > max) {
      next = sliceToCodePoints(next, max);
      e.target.value = next;
    }
    if (!isControlled) setInner(next);
    if (onChange) onChange(e);
  };

  const descId = `${baseId}-desc`;
  const describedBy = [descId, ariaDescribedBy].filter(Boolean).join(" ");

  const overError = over ? overLimitMessage || defaultOverLimitMessage(max, fmt) : "";
  const shownError = error || overError;

  const counter = (
    <span
      data-text-counter=""
      data-over={over ? "true" : undefined}
      aria-hidden="true"
      {...counterProps}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        fontVariantNumeric: "tabular-nums",
        fontWeight: over ? "var(--weight-semibold)" : "var(--weight-regular)",
        color: over ? "var(--error-color)" : "var(--text-tertiary)",
        ...(counterProps && counterProps.style),
      }}
    >
      {fmt(count)} / {fmt(max)}
    </span>
  );

  return (
    <div data-textarea-with-counter="" style={{ position: "relative", width: "100%" }}>
      <Textarea
        {...rest}
        value={text}
        onChange={handleChange}
        error={shownError}
        labelAccessory={counter}
        aria-describedby={describedBy}
      />
      <span id={descId} style={SR_ONLY}>
        {message}
      </span>
      <span role="status" aria-live="polite" aria-atomic="true" style={SR_ONLY}>
        {announced}
      </span>
    </div>
  );
}
