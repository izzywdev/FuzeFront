import * as React from "react";

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  /** Calling code without the leading `+`. */
  dial: string;
  name: string;
}

/** The curated calling-code list the picker offers. */
export const PHONE_COUNTRIES: PhoneCountry[];

/** True for a syntactically valid E.164 number (`+` then 7-15 digits, no leading 0). */
export function isValidE164(value: string): boolean;

export interface PhoneChangeMeta {
  /** The composed number passes the E.164 envelope check. */
  valid: boolean;
  /** The selected country's ISO code. */
  iso: string;
}

/**
 * E.164 phone field: a country calling-code picker plus a national-number
 * input, controlled by an E.164 string (`""` when empty). `onChange` receives
 * the composed number and a validity flag.
 */
export interface PhoneNumberInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  label?: React.ReactNode;
  /** E.164 value (`"+447700900123"`) or `""`. */
  value?: string;
  onChange?: (e164: string, meta: PhoneChangeMeta) => void;
  /** Consumer-supplied error; always wins over the built-in invalid message. */
  error?: string;
  hint?: React.ReactNode;
  /** ISO code selected when `value` is empty. Default `"US"`. */
  defaultCountry?: string;
  /** Accessible name of the country picker. */
  countryLabel?: string;
  placeholder?: string;
  /** Shown after blur when a non-empty value is not valid E.164. */
  invalidMessage?: string;
  disabled?: boolean;
  required?: boolean;
  /** id of the national-number input (wired to the label). */
  id?: string;
}

export function PhoneNumberInput(props: PhoneNumberInputProps): React.JSX.Element;
