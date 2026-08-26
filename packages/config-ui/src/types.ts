import type { Scope } from '@fuzefront/config-client'

/**
 * Resolves a `Scope` to its human-facing display name (e.g. "Acme Corp" for
 * `{ scopeType: 'org', scopeId: 'org_…' }`). The host owns identity data
 * (portal/org/user names) — this package never fetches names itself, so a
 * lookup miss falls back to the raw `scopeId`, never a blank label.
 */
export type ScopeNameResolver = (scope: Scope) => string

/** One step of the platform→portal→org→user chain, with its display name resolved. */
export interface ScopeChainStep {
  scope: Scope
  name: string
}
