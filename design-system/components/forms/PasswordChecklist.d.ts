import * as React from "react";

/** A single password-policy requirement. */
export interface PasswordRule {
  /** Stable key. */
  id: string;
  /** Human-readable requirement text. */
  label: string;
  /** Returns true when the given password satisfies this rule. */
  test: (value: string) => boolean;
}

/**
 * Default policy — mirrors the rules the Security API (Authentik) enforces
 * server-side: 12+ chars, upper, lower, digit, symbol.
 */
export declare const DEFAULT_PASSWORD_RULES: PasswordRule[];

/** True when `value` satisfies every rule — the client-side submit gate. */
export declare function passwordMeetsPolicy(
  value: string,
  rules?: PasswordRule[]
): boolean;

export interface PasswordChecklistProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** Current password value being validated. */
  value?: string;
  /** Policy rules to display; defaults to {@link DEFAULT_PASSWORD_RULES}. */
  rules?: PasswordRule[];
  /** Heading shown above the list; pass "" to hide. */
  title?: string;
}

export function PasswordChecklist(props: PasswordChecklistProps): JSX.Element;

// Pure helpers surfaced as statics so feature code reaches them through the
// package barrel (which only re-exports the component itself).
export namespace PasswordChecklist {
  /** True when `value` satisfies every rule — the client-side submit gate. */
  function meetsPolicy(value: string, rules?: PasswordRule[]): boolean;
  /** The default policy rules ({@link DEFAULT_PASSWORD_RULES}). */
  const rules: PasswordRule[];
}
