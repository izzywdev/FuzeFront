import React from "react";

/**
 * Country calling codes offered by the picker. Deliberately a curated list of
 * the markets FuzeFront customers sign up from — not a full ITU table and not a
 * libphonenumber replacement. Validation is the E.164 envelope only (`+`, a
 * non-zero first digit, 7-15 digits total); the delivering service (WhatsApp /
 * SMS) is the authority on whether a number is actually reachable.
 */
export const PHONE_COUNTRIES = [
  { iso: "US", dial: "1", name: "United States" },
  { iso: "CA", dial: "1", name: "Canada" },
  { iso: "GB", dial: "44", name: "United Kingdom" },
  { iso: "IE", dial: "353", name: "Ireland" },
  { iso: "IL", dial: "972", name: "Israel" },
  { iso: "DE", dial: "49", name: "Germany" },
  { iso: "FR", dial: "33", name: "France" },
  { iso: "ES", dial: "34", name: "Spain" },
  { iso: "IT", dial: "39", name: "Italy" },
  { iso: "NL", dial: "31", name: "Netherlands" },
  { iso: "BE", dial: "32", name: "Belgium" },
  { iso: "CH", dial: "41", name: "Switzerland" },
  { iso: "AT", dial: "43", name: "Austria" },
  { iso: "PT", dial: "351", name: "Portugal" },
  { iso: "PL", dial: "48", name: "Poland" },
  { iso: "SE", dial: "46", name: "Sweden" },
  { iso: "NO", dial: "47", name: "Norway" },
  { iso: "DK", dial: "45", name: "Denmark" },
  { iso: "FI", dial: "358", name: "Finland" },
  { iso: "TR", dial: "90", name: "Türkiye" },
  { iso: "AE", dial: "971", name: "United Arab Emirates" },
  { iso: "SA", dial: "966", name: "Saudi Arabia" },
  { iso: "EG", dial: "20", name: "Egypt" },
  { iso: "ZA", dial: "27", name: "South Africa" },
  { iso: "NG", dial: "234", name: "Nigeria" },
  { iso: "KE", dial: "254", name: "Kenya" },
  { iso: "IN", dial: "91", name: "India" },
  { iso: "SG", dial: "65", name: "Singapore" },
  { iso: "HK", dial: "852", name: "Hong Kong" },
  { iso: "JP", dial: "81", name: "Japan" },
  { iso: "KR", dial: "82", name: "South Korea" },
  { iso: "CN", dial: "86", name: "China" },
  { iso: "AU", dial: "61", name: "Australia" },
  { iso: "NZ", dial: "64", name: "New Zealand" },
  { iso: "BR", dial: "55", name: "Brazil" },
  { iso: "MX", dial: "52", name: "Mexico" },
  { iso: "AR", dial: "54", name: "Argentina" },
];

const E164 = /^\+[1-9]\d{6,14}$/;

/** True for a syntactically valid E.164 number (`+` then 7-15 digits, no leading 0). */
export function isValidE164(value) {
  return typeof value === "string" && E164.test(value);
}

const digitsOf = (s) => String(s || "").replace(/\D/g, "");

/** Split an E.164 string into `{ iso, national }` using the longest matching dial code. */
function splitE164(value, fallbackIso) {
  const digits = digitsOf(value);
  if (!value || !digits) return { iso: fallbackIso, national: "" };
  let best = null;
  for (const c of PHONE_COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  if (!best) return { iso: fallbackIso, national: digits };
  // Prefer the caller's country when several share this dial code (US/CA).
  const preferred = PHONE_COUNTRIES.find((c) => c.iso === fallbackIso && c.dial === best.dial);
  return { iso: (preferred || best).iso, national: digits.slice(best.dial.length) };
}

const dialOf = (iso) => (PHONE_COUNTRIES.find((c) => c.iso === iso) || PHONE_COUNTRIES[0]).dial;

/**
 * E.164 phone field — a country calling-code picker beside a national-number
 * input. It is **controlled by an E.164 string** (`"+447700900123"`, or `""`
 * when empty): `onChange(e164, { valid, iso })` fires on every edit with the
 * composed number, so the form never has to join a dial code and digits itself.
 *
 * Validation is the E.164 envelope only (see {@link isValidE164}). The built-in
 * message shows after the field has been blurred with a non-empty invalid value,
 * or whenever the consumer passes `error` (which always wins). `aria-invalid`
 * and a described-by error id are wired so assistive tech announces it.
 *
 * Logical properties only — under RTL the picker sits at the inline-start edge
 * while the digits stay left-to-right (`dir="ltr"` on the number input), the
 * convention for phone numbers in RTL locales.
 */
export function PhoneNumberInput({
  label,
  value = "",
  onChange,
  error = "",
  hint,
  defaultCountry = "US",
  countryLabel = "Country code",
  placeholder = "555 010 4477",
  invalidMessage = "Enter a valid number in full international format.",
  disabled = false,
  required = false,
  id,
  style,
  ...rest
}) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  const errId = `${fieldId}-err`;
  const hintId = `${fieldId}-hint`;

  const [iso, setIso] = React.useState(() => splitE164(value, defaultCountry).iso);
  const [national, setNational] = React.useState(() => splitE164(value, defaultCountry).national);
  const [touched, setTouched] = React.useState(false);

  // Re-sync only when the parent changes the value to something this field did
  // not itself compose (e.g. a form reset) — never fight the user's typing.
  React.useEffect(() => {
    const composed = national ? `+${dialOf(iso)}${digitsOf(national)}` : "";
    if (value !== composed) {
      const next = splitE164(value, iso);
      setIso(next.iso);
      setNational(next.national);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nextIso, nextNational) => {
    const digits = digitsOf(nextNational);
    const e164 = digits ? `+${dialOf(nextIso)}${digits}` : "";
    if (onChange) onChange(e164, { valid: isValidE164(e164), iso: nextIso });
  };

  const composedNow = national ? `+${dialOf(iso)}${digitsOf(national)}` : "";
  const autoInvalid = touched && composedNow !== "" && !isValidE164(composedNow);
  const message = error || (autoInvalid ? invalidMessage : "");
  const hasError = Boolean(message);
  const border = hasError ? "var(--error-color)" : "var(--border-color)";

  const fieldStyle = {
    boxSizing: "border-box",
    padding: "var(--space-3)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    lineHeight: 1.4,
    color: "var(--text-primary)",
    background: "var(--bg-secondary)",
    border: `1px solid ${border}`,
    borderRadius: "var(--radius-md)",
    outline: "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "text",
  };

  const ring = (on) => (e) => {
    e.currentTarget.style.borderColor = on ? (hasError ? "var(--error-color)" : "var(--accent-color)") : border;
    e.currentTarget.style.boxShadow = on ? "0 0 0 3px var(--accent-soft)" : "none";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", width: "100%", ...style }} {...rest}>
      {label && (
        <label
          htmlFor={fieldId}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-secondary)",
            lineHeight: 1.2,
          }}
        >
          {label}
          {required ? <span aria-hidden="true" style={{ color: "var(--error-color)" }}> *</span> : null}
        </label>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)", width: "100%" }}>
        <select
          aria-label={countryLabel}
          value={iso}
          disabled={disabled}
          onChange={(e) => {
            setIso(e.target.value);
            emit(e.target.value, national);
          }}
          onFocus={ring(true)}
          onBlur={ring(false)}
          style={{ ...fieldStyle, flex: "none", inlineSize: "9rem", cursor: disabled ? "not-allowed" : "pointer" }}
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {`${c.iso} +${c.dial}`}
            </option>
          ))}
        </select>
        <input
          id={fieldId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          dir="ltr"
          value={national}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={[hasError ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
          onChange={(e) => {
            setNational(e.target.value);
            emit(iso, e.target.value);
          }}
          onFocus={ring(true)}
          onBlur={(e) => {
            setTouched(true);
            ring(false)(e);
          }}
          style={{ ...fieldStyle, flex: 1, minInlineSize: 0 }}
        />
      </div>
      {hasError && (
        <span
          id={errId}
          role="alert"
          data-error-code="INVALID_PHONE"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--error-color)",
            lineHeight: 1.3,
          }}
        >
          {message}
        </span>
      )}
      {hint && !hasError && (
        <span
          id={hintId}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            color: "var(--text-tertiary)",
            lineHeight: 1.3,
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
