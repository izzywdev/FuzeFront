// lib/permitKeys.ts - the form in which tenants and users are named TO the Security API.
//
// The Security API hands `tenant` and `subject` to Permit UNCHANGED, and Permit keys tenants and users by the
// BARE UUID (`organizations.id` / `users.id`; backend/security/src/utils/permit/{tenant-management,user-sync}.ts;
// docs/guides/SELECTION_LIST_SERVICE.md "Org id form"). Permit keys are opaque strings, so `org_X` and the UUID of
// X are two different tenants: a decision or a grant sent under the TypeID can never match what is provisioned.
// Org-session tokens carry the bare UUID (services/orgSessionToken.ts) but this service also handles TypeIDs
// (seeding and events speak the wire form, the access routes take a `usr_` path id), so EVERY call to the
// Security API goes through the wrapper below, which sends the bare UUID:
//
//   tenant  : `org_...` TypeID -> its UUID; a bare UUID is left as is; anything else is REFUSED
//   subject : `usr_...` TypeID -> its UUID; a bare UUID is left as is; a namespaced non-user principal
//             (`svc:<client>`, `service:<name>`, `svc_token:<id>` - anything containing ':') is left as is;
//             anything else is REFUSED
//
// Fail closed: an id that parses as none of those is never passed through "as is" (a malformed key could name
// a different principal in Permit). A refused decision is an error (callers already treat a thrown decision
// as a denial), a refused write throws and rolls its transaction back.

import { AuthzClient, AuthzError } from '@fuzefront/auth';
import { isUuid, parseId, toUuid } from '@izzywdev/fuzefront-identity';

export class PermitKeyError extends AuthzError {
  constructor(what: 'tenant' | 'subject') {
    super('MALFORMED', `The ${what} is not a valid ${what === 'tenant' ? 'organization' : 'user'} id.`, 400);
    this.name = 'PermitKeyError';
  }
}

/** The tenant key Permit knows an organization by (its bare UUID). Throws `PermitKeyError`. */
export function permitTenantKey(id: string): string {
  if (typeof id === 'string') {
    if (isUuid(id)) return id;
    if (id.startsWith('org_')) {
      try {
        return toUuid(parseId('organization', id));
      } catch {
        // fall through to the refusal
      }
    }
  }
  throw new PermitKeyError('tenant');
}

/** The subject key Permit knows a principal by. Throws `PermitKeyError`. */
export function permitSubjectKey(id: string): string {
  if (typeof id === 'string') {
    if (isUuid(id)) return id;
    if (id.startsWith('usr_')) {
      try {
        return toUuid(parseId('user', id));
      } catch {
        // fall through to the refusal
      }
    } else if (id.includes(':') && id.length > 1 && !/\s/.test(id)) {
      return id; // a namespaced non-user principal (machine identity), never a user id
    }
  }
  throw new PermitKeyError('subject');
}

/** Wrap an `AuthzClient` so every tenant / subject it sends is in Permit's key form. */
export function permitKeyedClient(inner: AuthzClient): AuthzClient {
  return {
    check: async (c, token) => inner.check({ ...c, subject: permitSubjectKey(c.subject), tenant: permitTenantKey(c.tenant) }, token),
    bulkCheck: async (cs, token) =>
      inner.bulkCheck(
        cs.map((c) => ({ ...c, subject: permitSubjectKey(c.subject), tenant: permitTenantKey(c.tenant) })),
        token,
      ),
    grant: async (r, token) => inner.grant({ ...r, subject: permitSubjectKey(r.subject), tenant: permitTenantKey(r.tenant) }, token),
    revoke: async (r, token) =>
      inner.revoke(
        {
          ...r,
          ...(r.subject !== undefined ? { subject: permitSubjectKey(r.subject) } : {}),
          ...(r.tenant !== undefined ? { tenant: permitTenantKey(r.tenant) } : {}),
        },
        token,
      ),
    listGrants: async (q, token) =>
      inner.listGrants(
        { ...q, ...(q.subject !== undefined ? { subject: permitSubjectKey(q.subject) } : {}), tenant: permitTenantKey(q.tenant) },
        token,
      ),
    setAttributes: async (r, token) => inner.setAttributes(r, token),
  } as AuthzClient;
}
