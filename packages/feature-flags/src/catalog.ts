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
  /**
   * FF-EPIC-17 / S4 (#656) — personal-context switcher + my-orgs routes.
   * Read in the browser via `useFlag()` in App.tsx / UserMenu /
   * OrganizationDetailPage. Default OFF. Release flag.
   * Owner: frontend-engineer (identity).
   * Removal criterion: reconciled switcher GA at 100% of users.
   */
  IDENTITY_PERSONAL_CONTEXT: 'fuzefront.identity.personal-context',
  /**
   * FF-EPIC-17 / S5 (#671 backend, #672 UI) — root/portal member directory.
   * Read in the browser via `useFlag()` in OrganizationDetailPage
   * (`/organizations/:id/directory` route). Default OFF. Release flag.
   * Owner: backend-engineer (identity).
   * Removal criterion: 100% rollout; flag-OFF path unexercised.
   */
  IDENTITY_MEMBER_DIRECTORY: 'fuzefront.identity.member-directory',
  /**
   * FF-EPIC-17 / S8 (#655) + S9 (#673) — Employee cross-org console.
   * Read in the browser via `useFlag()` in SidePanel / EmployeeConsolePage
   * (`/staff` routes), gated additionally on `isEmployee`. Default OFF.
   * Release flag. Owner: backend-engineer (identity).
   * Removal criterion: 100% rollout; flag-OFF path unexercised.
   */
  IDENTITY_EMPLOYEE_CONSOLE: 'fuzefront.identity.employee-console',
  /**
   * FF-EPIC-17-S7 (#704 backend, master-admin portal console UI). Master
   * switch for the multi-tenant portals feature; this UI reuses it to gate
   * the master-admin portal fleet console (`/admin/portals`,
   * `MasterAdminPortalsFlow`) per `design/frames/portal-admin-consoles/
   * manifest.json`'s declared `featureFlag` for the `master-admin-portals`
   * build flow. Read in the browser via `useFlag()` in
   * `frontend/src/pages/MasterAdminPortalsPage.tsx`. Default OFF. Release
   * flag. Owner: platform team.
   * Removal criterion: when multi-tenant portals are GA and enabled for
   * 100% of orgs (see `flag-registry.yaml`).
   *
   * Was declared `web_exposed: false` in `flag-registry.yaml` (server-only,
   * gating the portal-shell/PortalLoginFlow boot surface) — adding this
   * entry is what actually discloses it to `GET /api/flags` for the master-
   * admin console's `useFlag()` read. Without it the flow's flag check
   * always falls back to its in-code default (OFF), same class of gap as #697.
   */
  MULTI_TENANT_PORTALS: 'fuzefront.platform.multi-tenant-portals',
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
  // FF-EPIC-17 identity UI flags — read in the browser via `useFlag()`. Without
  // these entries the backend `GET /api/flags` never discloses them, so flipping
  // them ON in Unleash would move server-side evaluation but leave the UI dark.
  // (`fuzefront.identity.root-membership` is deliberately NOT here — it is
  // server-only, read directly by the security service's provisioning path.)
  { key: FLAG_KEYS.IDENTITY_PERSONAL_CONTEXT, type: 'release', default: false },
  { key: FLAG_KEYS.IDENTITY_MEMBER_DIRECTORY, type: 'release', default: false },
  { key: FLAG_KEYS.IDENTITY_EMPLOYEE_CONSOLE, type: 'release', default: false },
  // FF-EPIC-17-S7 — the master-admin portal fleet console reuses this master
  // switch (see FLAG_KEYS doc). Registry `web_exposed` flipped false -> true
  // to match: this entry is what makes GET /api/flags disclose it at all.
  { key: FLAG_KEYS.MULTI_TENANT_PORTALS, type: 'release', default: false },
] as const;
