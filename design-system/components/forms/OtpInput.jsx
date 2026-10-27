import React from "react";

/**
 * True only when EVERY cell is filled. A cleared middle cell is a blank (a space) inside
 * the value (`"12 456"`), so `value.length === length` is NOT a completeness test —
 * gate submit buttons on this (or on the second `onChange` argument), never on length.
 */
export function isOtpComplete(value, length = 6) {
  return typeof value === "string" && value.length === length && !/\s/.test(value);
}

/**
 * Segmented one-time-code input — one cell per digit. Paste-aware (a pasted
 * code fills every cell), auto-advances on entry, Backspace/Arrow keys move
 * between cells, and `autoComplete="one-time-code"` lets the OS offer the SMS
 * code. Digits always lay out left-to-right (`dir="ltr"`), even in an RTL page.
 *
 * Controlled (`value` + `onChange`) or uncontrolled. `onComplete` fires once
 * every cell is filled. `error` borders the cells red and sets `aria-invalid`.
 * `size="touch"` gives each cell a >= 44px tap target for mobile / TWA use.
 * Cells are container-relative: below their nominal width they SHRINK (flex) to
 * keep the whole row inside the host's content box instead of clipping the last
 * cell when the group is nested in a narrow card. `touch` cells never shrink below
 * the touch target. Tokens only.
 */
export function OtpInput({
  length = 6,
  value,
  defaultValue = "",
  onChange,
  onComplete,
  disabled = false,
  error = false,
  size = "md",
  numeric = true,
  autoFocus = false,
  "aria-label": ariaLabel = "One-time code",
  cellLabel = (n) => `digit ${n}`,
  style,
  ...rest
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = React.useState(() => (defaultValue || "").slice(0, length));
  const current = (controlled ? value : inner) || "";
  const refs = React.useRef([]);

  const sanitize = (raw) =>
    numeric ? String(raw).replace(/\D/g, "") : String(raw).replace(/\s/g, "");

  const commit = (next) => {
    const clipped = next.slice(0, length);
    if (!controlled) setInner(clipped);
    const complete = isOtpComplete(clipped, length);
    if (onChange) onChange(clipped, complete);
    if (complete && onComplete) onComplete(clipped);
  };

  const focusCell = (i) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    if (el) {
      el.focus();
      if (el.select) el.select();
    }
  };

  // A blank cell inside the value is a space; trailing blanks are trimmed so
  // `value.length` is the count of leading filled cells.
  const setCell = (i, ch) => {
    const chars = current.padEnd(length, " ").split("");
    chars[i] = ch === "" ? " " : ch;
    commit(chars.join("").replace(/\s+$/, ""));
  };

  const fill = (start, text) => {
    const chars = current.padEnd(length, " ").split("");
    const digits = sanitize(text).slice(0, length - start).split("");
    digits.forEach((d, k) => {
      chars[start + k] = d;
    });
    commit(chars.join("").replace(/\s+$/, ""));
    focusCell(Math.min(start + digits.length, length - 1));
  };

  const onCellChange = (i, e) => {
    const typed = sanitize(e.target.value);
    if (typed === "") {
      setCell(i, "");
      return;
    }
    if (typed.length > 1) {
      // Autofill / multi-char input into one cell: spread across the cells.
      fill(i, typed);
      return;
    }
    setCell(i, typed);
    if (i < length - 1) focusCell(i + 1);
  };

  const onPaste = (i, e) => {
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    const clean = sanitize(text);
    if (!clean) return;
    e.preventDefault();
    // A full code pasted into any cell replaces the whole value.
    fill(clean.length >= length ? 0 : i, text);
  };

  const onKeyDown = (i, e) => {
    const filled = current[i] && current[i] !== " ";
    if (e.key === "Backspace" && !filled) {
      e.preventDefault();
      if (i > 0) {
        setCell(i - 1, "");
        focusCell(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCell(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusCell(i + 1);
    }
  };

  const touch = size === "touch";
  const restingBorder = error ? "var(--error-color)" : "var(--border-color)";
  const restingShadow = error ? "0 0 0 3px var(--error-soft)" : "none";
  const cellStyle = {
    boxSizing: "border-box",
    width: touch ? "var(--touch-target)" : "var(--space-10)",
    // md cells shrink with the container (min-width:0 overrides the input's intrinsic
    // minimum); touch cells keep their tap target.
    flex: touch ? undefined : "1 1 auto",
    minWidth: touch ? "var(--touch-target)" : 0,
    maxWidth: touch ? undefined : "var(--space-10)",
    height: touch ? "calc(var(--touch-target) + var(--space-2))" : "var(--space-12)",
    textAlign: "center",
    fontFamily: "var(--font-mono)",
    fontSize: touch ? "var(--text-xl)" : "var(--text-lg)",
    fontWeight: "var(--weight-semibold)",
    color: "var(--text-primary)",
    background: "var(--bg-secondary)",
    border: `1px solid ${restingBorder}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    padding: 0,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "text",
    boxShadow: restingShadow,
    transition:
      "border-color var(--duration-base) var(--ease-standard), box-shadow var(--duration-base) var(--ease-standard)",
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      dir="ltr"
      data-component="otp-input"
      style={{ display: "flex", maxWidth: "100%", gap: touch ? "var(--space-2)" : "var(--space-3)", ...style }}
      {...rest}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode={numeric ? "numeric" : "text"}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          maxLength={length}
          value={current[i] && current[i] !== " " ? current[i] : ""}
          disabled={disabled}
          aria-label={cellLabel(i + 1)}
          aria-invalid={error || undefined}
          style={cellStyle}
          onChange={(e) => onCellChange(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => {
            e.currentTarget.select();
            if (!error) {
              e.currentTarget.style.borderColor = "var(--accent-color)";
              e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-soft)";
            }
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = restingBorder;
            e.currentTarget.style.boxShadow = restingShadow;
          }}
        />
      ))}
    </div>
  );
}

// Pure helper surfaced as a static so feature code reaches it through the barrel.
OtpInput.isComplete = isOtpComplete;
