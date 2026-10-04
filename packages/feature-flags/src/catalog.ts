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
   * Gates showing org-context required apps as disabled in non-org context.
   * Default ON in production. OPS-KILL-SWITCH (not release): the gated
   * behaviour is a permanent, GA'd platform capability that ships ON; OFF is
   * the break-glass that turns the org-context gating off. Owner:
   * frontend-engineer. Removal criterion: only if org-context gating itself
   * is removed from the shell.
   */
  APPS_ORG_CONTEXT_DISABLED: 'fuzefront.apps.org-context-disabled',
  /**
   * Gates completely hiding org-context required apps in non-org context.
   * Default OFF in production. Release flag.
   */
  APPS_ORG_CONTEXT_HIDDEN: 'fuzefront.apps.org-context-hidden',
  /**
   * FF-EPIC-17 / FFRNT-201 — S15
   * Gates ALL selection-list surface, server and client. Enable per-org
   * as the service rolls out. Default OFF. Release flag.
   * Owner: platform team.
   * Removal criterion: when the service is GA and enabled for 100% of orgs
   * and stable for one release cycle (then delete flag + every guard below).
   * Gates:
   *   1. selection-list-service API — every /v1/selection-lists/* route and
   *      /v1/resolve answer 404 while OFF (service-side)
   *   2. "Selection Lists" entry in the shell left sidebar (UI-side, S9)
   *   3. /settings/selection-lists* shell routes (UI-side redirect)
   * Web-exposed (WEB_EXPOSED_FLAGS) — required for the browser to see it.
   * Runbook: docs/runbooks/selection-lists-flag-rollout.md
   */
  SELECTION_LISTS_SERVICE: 'fuzefront.selection-lists.service',
  /**
   * SL5/SL6 — selection-list default-seeding (docs/planning/selection-lists-events.md
   * section 11). Gates BOTH new selection-list-service consumers — the
   * `identity.org.created` seeding consumer and the `selection-lists.seed.requested`
   * handler (plus the reconciler). Default OFF. Release flag. Owner: izzywdev.
   * Removal criterion: seeding ON for all orgs for 30 days with zero
   * `selection-lists.seed.failed` in the window.
   * SERVER-ONLY (`web_exposed: false`): deliberately NOT in WEB_EXPOSED_FLAGS —
   * the browser never reads it. The constant lives here so the key is not a bare
   * string; the service reads it via isSeedDefaultsEnabled() in
   * services/selection-list-service/src/flags.ts. Independent of, and additionally
   * requires, SELECTION_LISTS_SERVICE.
   */
  SELECTION_LISTS_SEED_DEFAULTS: 'fuzefront.selection-lists.seed-defaults',
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
  /**
   * FF-EPIC-14 — per-portal admin console: the Users tab
   * (`PortalAdminConsoleFlow` / `UsersTab` / `InviteUserDialog`). Read in the
   * browser via `useFlag()` in `frontend/src/pages/PortalAdminConsolePage.tsx`.
   * Default OFF. Release flag. Owner: platform team.
   * Removal criterion: when the per-portal console is GA for 100% of portals.
   * Without this entry `GET /api/flags` never discloses it, so the console's
   * `useFlag()` falls back to its in-code default (OFF) — same gap class as the
   * MULTI_TENANT_PORTALS note above.
   */
  IDENTITY_PORTAL_SCOPED_USERS: 'fuzefront.identity.portal-scoped-users',
  /**
   * FF-EPIC-14 — per-portal admin console: the Catalog tab (`CatalogTab`).
   * Read in the browser via `useFlag()` in
   * `frontend/src/pages/PortalAdminConsolePage.tsx`. Default OFF. Release flag.
   * Owner: platform team.
   * Removal criterion: when the per-portal catalog is GA for 100% of portals.
   */
  APPS_PORTAL_CATALOG: 'fuzefront.apps.portal-catalog',
  /**
   * FF-EPIC-14 — portal billing: the reseller Stripe-connect surface
   * (`PortalBillingFlow`, `/portal/admin/billing`). Read in the browser via
   * `useFlag()` in `frontend/src/pages/PortalBillingPage.tsx`. Default OFF.
   * Release flag. Owner: feature-flags-engineer (billing domain).
   * Removal criterion: when reseller billing is GA for 100% of reseller
   * portals. Real entitlement still enforced by Permit, never this flag.
   */
  BILLING_RESELLER_CONNECT: 'fuzefront.billing.reseller-connect',

  // ── Plan-tier permission flags ─────────────────────────────────────────────
  // These gate UI surfaces and server routes by subscription tier. They are
  // ROLLOUT CONVENIENCE ONLY — real entitlement enforcement stays in Permit
  // (permit.check). Flipping a flag does not bypass authorization.
  // Long-lived: removed only if the corresponding tier is retired.
  // Owner: feature-flags-engineer (billing domain).

  /**
   * fuzefront.billing.plan-starter
   * Type: permission. Default: TRUE (every org on the lowest tier gets starter features).
   * Gates: basic features, up to 5 members.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire only if the Starter tier is removed from the product.
   */
  BILLING_PLAN_STARTER: 'fuzefront.billing.plan-starter',
  /**
   * fuzefront.billing.plan-professional
   * Type: permission. Default: FALSE (gate Pro features; enabled per-org by billing sync).
   * Gates: advanced features, SSO, API access, up to 25 members.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire only if Professional tier is removed from the product.
   */
  BILLING_PLAN_PROFESSIONAL: 'fuzefront.billing.plan-professional',
  /**
   * fuzefront.billing.plan-scale
   * Type: permission. Default: FALSE (gate Scale features; enabled per-org by billing sync).
   * Gates: full platform, all products, up to 100 members.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire only if Scale tier is removed from the product.
   */
  BILLING_PLAN_SCALE: 'fuzefront.billing.plan-scale',
  /**
   * fuzefront.billing.plan-enterprise
   * Type: permission. Default: FALSE (gate Enterprise features; enabled per-org by billing sync).
   * Gates: unlimited members, on-premise option, custom SLA.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire only if Enterprise tier is removed from the product.
   */
  BILLING_PLAN_ENTERPRISE: 'fuzefront.billing.plan-enterprise',
  /**
   * fuzefront.billing.sso-enabled
   * Type: permission. Default: FALSE.
   * Gates: SSO/SAML configuration UI and the Authentik SSO integration routes.
   * Requires Professional tier or above. Real SSO authz enforced by Permit.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire if SSO becomes available on all tiers.
   */
  BILLING_SSO_ENABLED: 'fuzefront.billing.sso-enabled',
  /**
   * fuzefront.billing.api-access
   * Type: permission. Default: FALSE.
   * Gates: API key management UI and the /api/keys routes.
   * Requires Professional tier or above. Real API-key authz enforced by Permit.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire if API access becomes available on all tiers.
   */
  BILLING_API_ACCESS: 'fuzefront.billing.api-access',
  /**
   * fuzefront.billing.custom-domain
   * Type: permission. Default: FALSE.
   * Gates: custom-domain configuration UI and the domain provisioning routes.
   * Requires Scale tier or above. Real domain authz enforced by Permit.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire if custom domains become available on all tiers.
   */
  BILLING_CUSTOM_DOMAIN: 'fuzefront.billing.custom-domain',
  /**
   * fuzefront.billing.module-federation
   * Type: permission. Default: FALSE.
   * Gates: Module-Federation hosting configuration UI and MF remote-serving routes.
   * Requires Professional tier or above. Real MF-hosting authz enforced by Permit.
   * Owner: feature-flags-engineer.
   * Removal criterion: retire if MF hosting becomes available on all tiers.
   */
  BILLING_MODULE_FEDERATION: 'fuzefront.billing.module-federation',
} as const;

/**
 * Server-side plan-tier flag keys for direct evaluation by backend services
 * without going through the browser. These keys mirror the billing permission
 * flags in FLAG_KEYS and are exported as a named group for ergonomic imports
 * in service code (e.g. `PLAN_FLAGS.PROFESSIONAL`).
 *
 * Usage (backend, server SDK):
 *   import { PLAN_FLAGS } from '@fuzefront/feature-flags';
 *   const isPro = await flags.getBooleanValue(PLAN_FLAGS.PROFESSIONAL, false, ctx);
 *
 * IMPORTANT: These are rollout-convenience gates. Real entitlement enforcement
 * must always go through Permit (permit.check) — never rely on a flag alone.
 */
export const PLAN_FLAGS = {
  STARTER: 'fuzefront.billing.plan-starter',
  PROFESSIONAL: 'fuzefront.billing.plan-professional',
  SCALE: 'fuzefront.billing.plan-scale',
  ENTERPRISE: 'fuzefront.billing.plan-enterprise',
} as const;

export const WEB_EXPOSED_FLAGS: readonly FlagDescriptor[] = [
  { key: FLAG_KEYS.ACCOUNT_SECURITY_HUB, type: 'release', default: false },
  { key: FLAG_KEYS.BILLING_INVOICE_HISTORY, type: 'release', default: false },
  // Kill-switch semantics: default ON (gating active), OFF is break-glass. The
  // taxonomy rule (kill-switch => default ON) is what makes default `true` correct.
  { key: FLAG_KEYS.APPS_ORG_CONTEXT_DISABLED, type: 'ops-kill-switch', default: true },
  { key: FLAG_KEYS.APPS_ORG_CONTEXT_HIDDEN, type: 'release', default: false },
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
  // FF-EPIC-14 per-portal admin console + portal billing — read in the browser
  // via `useFlag()` in PortalAdminConsolePage / PortalBillingPage. Without these
  // entries GET /api/flags never discloses them, so flipping them ON in Unleash
  // would move server-side evaluation but leave the console/billing UI dark.
  { key: FLAG_KEYS.IDENTITY_PORTAL_SCOPED_USERS, type: 'release', default: false },
  { key: FLAG_KEYS.APPS_PORTAL_CATALOG, type: 'release', default: false },
  { key: FLAG_KEYS.BILLING_RESELLER_CONNECT, type: 'release', default: false },

  // ── Plan-tier permission flags ─────────────────────────────────────────────
  // Exposed to the browser so the shell UI can conditionally render plan-gated
  // surfaces (upgrade prompts, locked nav items). Real authorization always
  // lives in Permit on the server — these flags are convenience only.
  //
  // plan-starter defaults TRUE: every org can access Starter-tier features by
  // default (fail-open for the base tier).
  { key: FLAG_KEYS.BILLING_PLAN_STARTER, type: 'permission', default: true },
  // All other plan flags default FALSE: higher-tier features are locked until
  // the billing sync enables them per-org in Unleash.
  { key: FLAG_KEYS.BILLING_PLAN_PROFESSIONAL, type: 'permission', default: false },
  { key: FLAG_KEYS.BILLING_PLAN_SCALE, type: 'permission', default: false },
  { key: FLAG_KEYS.BILLING_PLAN_ENTERPRISE, type: 'permission', default: false },
  // Capability flags (also gated by plan; Permit enforces server-side).
  { key: FLAG_KEYS.BILLING_SSO_ENABLED, type: 'permission', default: false },
  { key: FLAG_KEYS.BILLING_API_ACCESS, type: 'permission', default: false },
  { key: FLAG_KEYS.BILLING_CUSTOM_DOMAIN, type: 'permission', default: false },
  { key: FLAG_KEYS.BILLING_MODULE_FEDERATION, type: 'permission', default: false },
] as const;
