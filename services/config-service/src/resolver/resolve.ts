/**
 * The resolution engine (FF-EPIC-17-S4) — a pure, DB-free function over
 * already-fetched definitions + values.
 *
 * Deliberately has NO Postgres/pg dependency and does no I/O: it is exactly
 * the function FFRNT-157 (GET /v1/config) and FFRNT-158 (PUT /v1/config) wire
 * to HTTP, and is unit-testable with plain object fixtures.
 *
 * Walks `default -> platform -> portal -> org -> user`, honours each key's
 * `precedence`, short-circuits at the outermost `is_locked`, and returns one
 * entry per visible key with its provenance — see
 * services/config-service/openapi.yaml `EffectiveConfigEntry` /
 * `getEffectiveConfig`, which this function's output must match exactly.
 */

import { ConfigValue, EffectiveConfigEntry, KeyDefinition, Scope } from '../types';
import { validateValue } from '../validation/schema';

export interface ResolveInput {
  /**
   * The chain of scopes to resolve, ordered LEAST specific to MOST specific
   * (e.g. `[platform, portal:P1, org:O1, user:U1]`). The LAST entry is "the
   * scope being read" — the one `editable` is computed for.
   *
   * Assembling this chain (which portal an org belongs to, which org a user
   * belongs to) is the caller's job — FF-EPIC-10's context-resolution
   * middleware per the S4 assumption. This function trusts it as given and
   * does no lookups of its own, which is what keeps it DB-free.
   */
  chain: Scope[];
  /**
   * Every key definition in the namespace being resolved. `isHidden` keys are
   * filtered out internally — the caller does not need to pre-filter them.
   */
  definitions: KeyDefinition[];
  /**
   * Every stored value row at ANY scope in `chain`, for ANY key in
   * `definitions`. Rows for scopes outside `chain`, or keys outside
   * `definitions`, are ignored (so the caller may over-fetch defensively).
   */
  values: ConfigValue[];
}

function scopeKey(scope: Scope): string {
  return `${scope.scopeType}:${scope.scopeId ?? ''}`;
}

/**
 * Resolves every visible key definition against the given chain + values,
 * returning one {@link EffectiveConfigEntry} per key. Pure: same inputs
 * always produce the same output, no I/O, no clock, no randomness.
 */
export function resolveEffectiveConfig(input: ResolveInput): EffectiveConfigEntry[] {
  const { chain, definitions, values } = input;
  if (chain.length === 0) {
    throw new Error('resolveEffectiveConfig: chain must have at least one scope');
  }
  const targetScope = chain[chain.length - 1];
  // Fallback provenance for "no override anywhere, serving the key's own
  // default": the least-specific link in the chain (normally `platform`).
  // `default` is conceptually the tier BENEATH platform in the contract's
  // prose ("default -> platform -> portal -> org -> user"), but the wire
  // `ScopeType` enum has no `default` member — only platform/portal/org/user
  // — so the least-specific real tier is the closest honest answer. Noted
  // here as an implementation decision for FFRNT-157/158 to carry forward
  // (or amend, contract-first, if the contract is later made explicit).
  const fallbackSource = chain[0];

  // Index stored values by (definitionId, scopeKey) for O(1) lookup per tier.
  const byDefinition = new Map<string, Map<string, ConfigValue>>();
  for (const row of values) {
    let byScope = byDefinition.get(row.definitionId);
    if (!byScope) {
      byScope = new Map();
      byDefinition.set(row.definitionId, byScope);
    }
    byScope.set(scopeKey({ scopeType: row.scopeType, scopeId: row.scopeId }), row);
  }

  const entries: EffectiveConfigEntry[] = [];

  for (const definition of definitions) {
    if (definition.isHidden) continue; // never rendered, never returned — server-side, not client-side.

    const rowsByScope = byDefinition.get(definition.id) ?? new Map<string, ConfigValue>();
    // Row present at each tier of the chain, in chain order (undefined = no override there).
    const rowsInChainOrder: (ConfigValue | undefined)[] = chain.map((s) => rowsByScope.get(scopeKey(s)));

    // ── 1. Lock scan — deliberately separate from precedence. ──────────────
    // The OUTERMOST (least-specific) locked tier wins over everything beneath
    // it, in EITHER precedence direction. Scan from the start of the chain
    // (platform-ward) so the first lock found is the least-specific one.
    let lockedIndex = -1;
    for (let i = 0; i < rowsInChainOrder.length; i++) {
      if (rowsInChainOrder[i]?.isLocked) {
        lockedIndex = i;
        break;
      }
    }

    let candidateValue: unknown;
    let candidateSource: Scope;
    let locked = false;
    let lockedBy: Scope | null = null;
    let lockReason: string | null = null;
    let hasOverride: boolean;

    if (lockedIndex >= 0) {
      const row = rowsInChainOrder[lockedIndex] as ConfigValue;
      candidateValue = row.value;
      candidateSource = chain[lockedIndex];
      locked = true;
      lockedBy = chain[lockedIndex];
      lockReason = row.lockReason ?? null;
      hasOverride = true;
    } else {
      // ── 2. Precedence scan — which end of the chain wins. ────────────────
      let winnerIndex = -1;
      if (definition.precedence === 'least-specific-wins') {
        // The org's value beats the user's: first (least specific) present row wins.
        for (let i = 0; i < rowsInChainOrder.length; i++) {
          if (rowsInChainOrder[i]) {
            winnerIndex = i;
            break;
          }
        }
      } else {
        // 'most-specific-wins' (default): the user's value beats the org's:
        // last (most specific) present row wins.
        for (let i = rowsInChainOrder.length - 1; i >= 0; i--) {
          if (rowsInChainOrder[i]) {
            winnerIndex = i;
            break;
          }
        }
      }

      if (winnerIndex >= 0) {
        const row = rowsInChainOrder[winnerIndex] as ConfigValue;
        candidateValue = row.value;
        candidateSource = chain[winnerIndex];
        hasOverride = true;
      } else {
        // Nothing set anywhere in the chain — fall back to the definition's
        // own default, which S2 AC4 guarantees already satisfies its schema.
        candidateValue = definition.defaultValue;
        candidateSource = fallbackSource;
        hasOverride = false;
      }
    }

    // ── 3. Stale-value guard (S4 AC4). ──────────────────────────────────────
    // A definition's schema can change after a value was written. Rather than
    // fail the whole resolution, serve the default and explain why — a stale
    // value must not break a consumer's boot. Provenance (source/locked/
    // lockedBy) is deliberately preserved: it still names WHERE the (now
    // invalid) override lives, which is exactly what an editor needs to
    // explain the warning to the caller.
    let warning: string | null = null;
    if (hasOverride) {
      const result = validateValue(definition.valueType, candidateValue, {
        schema: definition.schema,
        enumValues: definition.enumValues,
      });
      if (!result.valid) {
        warning = `stored value no longer satisfies its definition; showing the default (${result.errors.join('; ')})`;
        candidateValue = definition.defaultValue;
      }
    }

    // ── 4. editable — purely computable inputs only. ────────────────────────
    // Permit write-authority over the target scope is assumed already granted
    // by the time a request reaches this function (the HTTP layer gates
    // reads/writes on Permit before calling the resolver); what THIS function
    // can compute is whether the lock, `isReadonly`, and `allowedScopes` would
    // additionally refuse a write at the scope being read.
    const editable =
      !locked && !definition.isReadonly && definition.allowedScopes.includes(targetScope.scopeType);

    const entry: EffectiveConfigEntry = {
      key: definition.key,
      value: definition.isSecret ? null : candidateValue,
      source: candidateSource,
      locked,
      lockedBy,
      lockReason,
      editable,
      warning,
      definition,
    };
    if (definition.isSecret) {
      entry.isSet = hasOverride;
    }
    entries.push(entry);
  }

  return entries;
}
