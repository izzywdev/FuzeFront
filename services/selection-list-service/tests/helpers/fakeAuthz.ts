// A scriptable in-memory Security API (AuthzClient) for the shared-lists suites.
//
// It models exactly what the service relies on of the real thing (docs/planning/selection-lists-permit-actions.md):
//   - CATALOG actions (`SelectionListCatalog:*`) are conferred by TENANT roles: `allowCatalog(tenant, subject,
//     actions)` says which a subject holds IN that tenant (a subject holds nothing in another tenant);
//   - LIST actions (`SelectionList:*`) are conferred ONLY by instance roles on `(tenant, list)`, created by
//     `grant()` (the service's owner bootstrap) or `give()`; tenant roles confer none;
//   - every query is recorded (`asked`) so tests can pin WHICH decisions a route asked for, in which tenant.

import type { AuthzClient } from '@fuzefront/auth';

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
    this.catalog.set(`${tenant}|${subject}`, new Set(actions));
  }

  give(tenant: string, subject: string, listId: string, role: string): void {
    this.roles.set(`${tenant}|${subject}|${listId}`, role);
  }

  private decide(q: Asked): boolean {
    if (q.resource.type === 'SelectionListCatalog') {
      return this.catalog.get(`${q.tenant}|${q.subject}`)?.has(q.action) ?? false;
    }
    const role = this.roles.get(`${q.tenant}|${q.subject}|${q.resource.key}`);
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
        this.roles.delete(`${r.tenant}|${r.subject}|${r.resource.key}`);
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
