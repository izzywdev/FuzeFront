import { PasswordChecklist } from '@fuzefront/design-system'

/**
 * Client-side policy gate — the SAME rules the design system's checklist and
 * meter show, so the hints and the gate can never disagree. The server remains
 * authoritative; this only avoids a round-trip for an obviously weak password.
 */
export function passwordMeetsPolicy(value: string): boolean {
  return PasswordChecklist.meetsPolicy(value)
}
