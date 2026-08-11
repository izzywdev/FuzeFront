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

/**
 * Named flag-key constants — import these instead of using bare strings so
 * the TypeScript compiler catches typos and IDEs can navigate to the definition.
 *
 * Only web-exposed flags (returned to the browser via GET /api/flags) have
 * constants here. Server-only flags live in their own slice's flags.ts.
 */
export const FLAG_KEYS = {
  ACCOUNT_SECURITY_HUB: 'fuzefront.account-security.hub',
  BILLING_INVOICE_HISTORY: 'fuzefront.billing.invoice-history',
  /**
   * FF-EPIC-17 / FFRNT-201 — S15
   * Gates the selection-list-service and its management UI. Enable per-org
   * as the service rolls out. Default OFF. Release flag.
   * Owner: platform team.
   * Removal criterion: when the service is GA and enabled for 100% of orgs.
   * Gates:
   *   1. selection-list-service Helm deployment (service-side)
   *   2. "Selection Lists" entry in the shell left sidebar (UI-side, S9)
   */
  SELECTION_LISTS_SERVICE: 'fuzefront.selection-lists.service',
  /**
   * Portals Directory (backend S1 #640 / frontend S3 #642).
   * Gates the /portals page + SidePanel "Portals" nav entry (UI-side) and
   * the identityMode/launchUrl fields on GET /api/v1/admin/portals
   * (server-side, evaluated independently in the backend route). Default
   * OFF. Release flag. Owner: platform team.
   * Removal criterion: when the Portals Directory is GA and enabled for
   * 100% of admins.
   */
  PORTALS_DIRECTORY: 'fuzefront.platform.portals-directory',
} as const;

export const WEB_EXPOSED_FLAGS: readonly FlagDescriptor[] = [
  { key: FLAG_KEYS.ACCOUNT_SECURITY_HUB, type: 'release', default: false },
  { key: FLAG_KEYS.BILLING_INVOICE_HISTORY, type: 'release', default: false },
  {
    key: FLAG_KEYS.SELECTION_LISTS_SERVICE,
    type: 'release',
    default: false,
  },
  { key: FLAG_KEYS.PORTALS_DIRECTORY, type: 'release', default: false },
] as const;
