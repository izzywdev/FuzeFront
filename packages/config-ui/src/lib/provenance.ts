import type { EffectiveConfigEntry, Scope, ScopeType } from '@fuzefront/config-client'

/**
 * The distinct shapes an `EffectiveConfigEntry` can take, mapped to exactly
 * one rendered provenance state — never a bare `value`. See
 * design/frames/config-management/02-provenance-and-lock.html.
 *
 *   - `stale` (warning present) is checked FIRST: a stale entry still carries
 *     `source`/`locked` from the fallback-to-default resolution, but the UI
 *     must show the orphaned-value warning, not a plain "default" badge.
 *   - `locked` next — an ancestor pinned this value; writes beneath it are
 *     refused server-side regardless of `editable`.
 *   - `set` when `source` names the scope actually being edited.
 *   - `inherited` when `source` names a different (ancestor) scope.
 *   - `default` when nothing further distinguishes the entry (definition
 *     default in force, no override anywhere).
 */
export type ProvenanceKind = 'set' | 'inherited' | 'locked' | 'default' | 'stale'

export function deriveProvenance(entry: EffectiveConfigEntry, editingScope: Scope): ProvenanceKind {
  if (entry.warning) return 'stale'
  if (entry.locked) return 'locked'
  if (sameScope(entry.source, editingScope)) return 'set'
  if (entry.source.scopeType === editingScope.scopeType && entry.source.scopeId == null && editingScope.scopeId == null) {
    return 'set'
  }
  // A source scope one tier "beneath" nothing (i.e. the definition default,
  // never overridden) still resolves with scopeType 'platform' in most
  // configurations, but the entry may also arrive with no distinguishing
  // ancestor at all. Anything not identified as this scope is inherited from
  // wherever `source` names.
  return sameScope(entry.source, editingScope) ? 'set' : isDefaultSource(entry) ? 'default' : 'inherited'
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.scopeType === b.scopeType && (a.scopeId ?? null) === (b.scopeId ?? null)
}

/**
 * Heuristic for "this is the definition default, not an override anywhere":
 * the source is the platform tier AND the resolved value equals the
 * definition's own default. A definition default that happens to be set
 * explicitly at platform is indistinguishable from "never overridden" by the
 * contract alone — both cases render identically ("in force from platform"),
 * which is the correct behavior (the value IS in force either way).
 */
function isDefaultSource(entry: EffectiveConfigEntry): boolean {
  return entry.source.scopeType === 'platform' && entry.source.scopeId == null
}

const SCOPE_ORDER: ScopeType[] = ['platform', 'portal', 'org', 'user']

/** True if `a` is the same tier or an ancestor tier of `b` (platform is the outermost ancestor). */
export function isAncestorOrSame(a: ScopeType, b: ScopeType): boolean {
  return SCOPE_ORDER.indexOf(a) <= SCOPE_ORDER.indexOf(b)
}

/** Render a `Scope` as "org Acme Corp" given a display-name resolver. */
export function formatScope(scope: Scope, nameOf: (scope: Scope) => string): string {
  return `${scope.scopeType} ${nameOf(scope)}`
}
