// A scriptable in-memory Security API (AuthzClient) for the shared-lists suites.
//
// It models exactly what the service relies on of the real thing (docs/planning/selection-lists-permit-actions.md):
//   - CATALOG actions (`SelectionListCatalog:*`) are conferred by TENANT roles: `allowCatalog(tenant, subject,
//     actions)` says which a subject holds IN that tenant (a subject holds nothing in another tenant);
//   - LIST actions (`SelectionList:*`) are conferred ONLY by instance roles on `(tenant, list)`, created by
//     `grant()` (the service's owner bootstrap) or `give()`; tenant roles confer none;
//   - every query is recorded (`asked`) so tests can pin WHICH decisions a route asked for, in which tenant.

import type { AuthzClient } from '@fuzefront/auth';
import { permitSubjectKey, permitTenantKey } from '../../src/lib/permitKeys';

// Permit knows tenants and users by their BARE UUID (the service sends exactly that, see src/lib/permitKeys.ts), so
// this double keys everything by it: a setup call may name an id in either rendering, but a decision or grant
// is only ever found under the key that was actually SENT (exact match).
const pk = (tenant: string, subject: string): string => `${permitTenantKey(tenant)}|${permitSubjectKey(subject)}`;
// Lookups are EXACT on what was sent: Permit does not know a TypeID as a second name for a UUID, so a request that
// reaches this double with a TypeID (or anything not already a Permit key) matches nothing.
const pkOrRaw = (tenant: string, subject: string): string => `${tenant}|${subject}`;

export const ROLE_ACTIONS: Record<string, string[]> = {
  'list-owner': ['read', 'add_value', 'update_value', 'remove_value', 'translate', 'update', 'delete', 'manage_access'],
  'list-editor': ['read', 'add_value', 'update_value', 'remove_value', 'translate', 'update'],
  'list-contributor': ['read', 'add_value', 'update_value', 'translate'],
  'list-translator': ['read', 'translate'],
  'list-viewer': ['read'],
};

export interface Asked {
  subject: string;
  tenant: string;
  resource: { type: string; key?: string };
  action: string;
}

export class FakeAuthz {
  readonly catalog = new Map<string, Set<string>>();
  readonly roles = new Map<string, string>();
  readonly asked: Asked[] = [];
  readonly grants: Array<{ subject: string; tenant: string; role: string; listId: string }> = [];
  readonly revokes: Array<{ subject: string; tenant: string; role: string; listId: string }> = [];
  /** When set, `check` / `bulkCheck` throw (the Security API is down). */
  down: Error | null = null;
  /** When set, `grant` throws. */
  grantFails: Error | null = null;

  allowCatalog(tenant: string, subject: string, actions: string[]): void {
    this.catalog.set(pk(tenant, subject), new Set(actions));
  }

  give(tenant: string, subject: string, listId: string, role: string): void {
    this.roles.set(`${pk(tenant, subject)}|${listId}`, role);
  }

  /** The role `subject` holds on `listId` in `tenant` (either rendering of the ids), if any. */
  roleOf(tenant: string, subject: string, listId: string): string | undefined {
    return this.roles.get(`${pk(tenant, subject)}|${listId}`);
  }

  /** Forget a role (test cleanup). */
  dropRole(tenant: string, subject: string, listId: string): void {
    this.roles.delete(`${pk(tenant, subject)}|${listId}`);
  }

  /** The catalog actions `subject` holds in `tenant` (either rendering of the ids), if any. */
  catalogOf(tenant: string, subject: string): Set<string> | undefined {
    return this.catalog.get(pk(tenant, subject));
  }

  /** `Organization:read` (the membership probe of access PUT): the double models it as a role on key `undefined`. */
  member(tenant: string, subject: string): void {
    this.roles.set(`${pk(tenant, subject)}|undefined`, 'list-viewer');
  }

  private decide(q: Asked): boolean {
    if (q.resource.type === 'SelectionListCatalog') {
      return this.catalog.get(pkOrRaw(q.tenant, q.subject))?.has(q.action) ?? false;
    }
    const role = this.roles.get(`${pkOrRaw(q.tenant, q.subject)}|${q.resource.key}`);
    return role ? (ROLE_ACTIONS[role] ?? []).includes(q.action) : false;
  }

  asAuthzClient(): AuthzClient {
    return {
      check: async (q: Asked) => {
        this.asked.push(q);
        if (this.down) throw this.down;
        return { allow: this.decide(q) };
      },
      bulkCheck: async (qs: Asked[]) => {
        for (const q of qs) this.asked.push(q);
        if (this.down) throw this.down;
        return qs.map((q) => ({ allow: this.decide(q) }));
      },
      grant: async (r: { subject: string; tenant: string; role: string; resource: { key: string } }) => {
        if (this.grantFails) throw this.grantFails;
        this.give(r.tenant, r.subject, r.resource.key, r.role);
        this.grants.push({ subject: r.subject, tenant: r.tenant, role: r.role, listId: r.resource.key });
        return r;
      },
      revoke: async (r: { subject: string; tenant: string; role: string; resource: { key: string } }) => {
        this.roles.delete(`${pkOrRaw(r.tenant, r.subject)}|${r.resource.key}`);
        this.revokes.push({ subject: r.subject, tenant: r.tenant, role: r.role, listId: r.resource.key });
      },
      listGrants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
      setAttributes: async () => undefined,
    } as unknown as AuthzClient;
  }

  /** The catalog / list checks asked since `mark`, as `type:action[@tenant]` strings. */
  since(mark: number): string[] {
    return this.asked.slice(mark).map((q) => `${q.resource.type === 'SelectionListCatalog' ? 'catalog' : 'list'}:${q.action}`);
  }
}
