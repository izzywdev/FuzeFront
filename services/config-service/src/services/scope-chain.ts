/**
 * Ancestor-chain assembly + outermost-lock detection for the WRITE path
 * (FFRNT-158 / FF-EPIC-17-S6).
 *
 * `resolve.ts` (FFRNT-156/S4) documents that assembling a scope's full
 * ancestor chain (which portal an org belongs to, which org a user belongs
 * to) is "the caller's job — FF-EPIC-10's context-resolution middleware per
 * the S4 assumption." That middleware does not exist yet anywhere in this
 * repo (config-service has no DB access to the portal/organization tables it
 * would need — those are owned by the `backend` monolith, and a cross-service
 * lookup is out of scope for this story). This module is the documented,
 * best-effort stand-in until FF-EPIC-10 ships one:
 *
 *  - `platform` is always a safe, unambiguous ancestor (a global singleton,
 *    no scopeId needed).
 *  - `portal`/`org` ancestors are populated ONLY from the CALLER's own JWT
 *    context (`portalId`/`orgId`), never from anything client-suppliable in
 *    the request body. This is deliberately safe against BOLA: by the time
 *    this chain is used, Permit has already authorized the write at the
 *    TARGET scope for this principal, so using the principal's own believed
 *    portal/org as the ancestor to check locks against never leaks another
 *    tenant's id into a response this principal has no authority over.
 *  - When the caller's token carries no portalId/orgId claim, that tier is
 *    simply ABSENT from the chain — a lock at that tier cannot be detected
 *    from this service alone — rather than guessed at (guessing wrong could
 *    either falsely refuse a legitimate write, or worse, incorrectly resolve
 *    to nothing and let an ancestor lock go unenforced).
 *
 * KNOWN LIMITATION, explicitly out of scope for FFRNT-158: an `org`-level
 * lock is not enforced against a `user`-scope write unless the caller's own
 * token happens to carry that org's id. Closing this gap requires either
 * FF-EPIC-10's middleware or an org-membership lookup capability this
 * service does not have. Tracked as a follow-up, not silently ignored.
 */

import { ConfigValue, Scope, ScopeType } from '../types';

export interface PrincipalScopeContext {
  portalId?: string;
  orgId?: string;
}

/**
 * Builds the ordered ancestor -> target chain for one write. The LAST entry
 * is always the scope being written to.
 */
export function buildWriteChain(target: Scope, principal: PrincipalScopeContext): Scope[] {
  const chain: Scope[] = [{ scopeType: 'platform', scopeId: null }];
  if (target.scopeType === 'platform') return chain;

  if (target.scopeType !== 'portal' && principal.portalId) {
    chain.push({ scopeType: 'portal', scopeId: principal.portalId });
  }
  if (target.scopeType === 'user' && principal.orgId) {
    chain.push({ scopeType: 'org', scopeId: principal.orgId });
  }
  chain.push(target);
  return chain;
}

/**
 * Finds the OUTERMOST (least-specific) locked row among the STRICT ancestors
 * of `chain`'s last entry (the target scope is never its own ancestor).
 *
 * `rowsForOneDefinition` must be rows for exactly ONE key definition, at any
 * scope — the caller filters `ValueRepository.listForDefinitions`'s result
 * per-definition first (see src/routes/config.write.ts).
 *
 * Matches rows to chain entries by `scopeType` ALONE, not by comparing
 * `scopeId` strings. This is deliberate: `ConfigValue.scopeId` is always
 * rendered in its WIRE (TypeID) form (`fromUuid` at the repository boundary),
 * while a chain entry's `scopeId` may be a legacy bare UUID (from a JWT claim
 * or a caller-supplied request scope) — the two encode the same underlying
 * entity but are not string-equal. Since `listForDefinitions` was queried
 * with THIS EXACT chain (one scope per tier, each already normalized via
 * `assertRef`/`toUuid` before the query ran), any returned row for a given
 * `scopeType` can only be the row that matched that tier's specific
 * `scope_id` clause — so `scopeType` alone is an unambiguous, correct key.
 */
export function findAncestorLock(chain: Scope[], rowsForOneDefinition: ConfigValue[]): Scope | null {
  const byTier = new Map<ScopeType, ConfigValue>();
  for (const row of rowsForOneDefinition) {
    byTier.set(row.scopeType, row);
  }
  // Ancestors are every entry EXCEPT the last (the target itself).
  for (let i = 0; i < chain.length - 1; i++) {
    const row = byTier.get(chain[i].scopeType);
    if (row?.isLocked) {
      return chain[i];
    }
  }
  return null;
}

/** The row (if any) at the EXACT target scope (chain's last entry), matched the same way. */
export function findRowAtTargetScope(chain: Scope[], rowsForOneDefinition: ConfigValue[]): ConfigValue | undefined {
  const target = chain[chain.length - 1];
  return rowsForOneDefinition.find((row) => row.scopeType === target.scopeType);
}
