/**
 * Catalog of flags the BROWSER is allowed to see.
 *
 * The host shell reads flags through the backend (`GET /api/flags`), not by
 * talking to Unleash directly. Two reasons, both deliberate:
 *
 *  1. **Identity cannot be spoofed.** Unleash's frontend API takes the
 *     evaluation context from client-supplied query params, so any user could
 *     pass the platform owner's `userId` and enrol themselves into the
 *     `developers` segment. Evaluating server-side against the authenticated
 *     session makes the cohort tamper-proof.
 *  2. **No Unleash token reaches the browser**, and no new public host / CF
 *     Access carve-out is needed — `/api/*` is already same-origin routed.
 *
 * Only flags listed here are returned to the browser; server-only flags (e.g.
 * the app-registry ones) are never disclosed. Keep `default` identical to the
 * in-code fallback so an Unleash outage fails safe.
 *
 * Owner: feature-flags-engineer.
 */
export type FlagType = 'release' | 'ops-kill-switch' | 'experiment' | 'permission';

export interface FlagDescriptor {
  key: string;
  type: FlagType;
  /** Fail-safe value used when Unleash is unreachable (release OFF / kill-switch ON). */
  default: boolean;
}

export const WEB_EXPOSED_FLAGS: readonly FlagDescriptor[] = [
  { key: 'fuzefront.account-security.hub', type: 'release', default: false },
  { key: 'fuzefront.billing.invoice-history', type: 'release', default: false },
] as const;
