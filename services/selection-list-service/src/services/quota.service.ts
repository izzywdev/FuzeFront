// quota.service.ts — QuotaResolver interface and default placeholder implementation.
//
// Full implementation (DB override → platform config ceiling resolution): S6.
// The interface is defined here so S4-S5 can inject it via DI without being
// blocked on S6 delivering the real resolver.

export interface QuotaLimits {
  /** Maximum selection lists per organization. */
  maxLists: number;
  /** Maximum selection lists per user within the organization. */
  maxListsPerUser: number;
  /** Maximum items per selection list. */
  maxItemsPerList: number;
  /** Maximum locales per selection list (bounded by the supported locale set). */
  maxLocales: number;
}

export interface QuotaResolver {
  resolve(organizationId: string): Promise<QuotaLimits>;
}

/**
 * DefaultQuotaResolver — placeholder used until S6 wires up the DB-override
 * → platform-config-ceiling resolution chain.
 *
 * Returns the platform-default ceilings unconditionally. S6 will replace this
 * with a resolver that checks `selection_list_org_quota` for per-org overrides
 * and falls back to a platform config value.
 *
 * The 11-locale ceiling matches the supported locale count in i18n.languages.json.
 */
export class DefaultQuotaResolver implements QuotaResolver {
  async resolve(_organizationId: string): Promise<QuotaLimits> {
    return {
      maxLists: 100,
      maxListsPerUser: 20,
      maxItemsPerList: 500,
      maxLocales: 11,
    };
  }
}
