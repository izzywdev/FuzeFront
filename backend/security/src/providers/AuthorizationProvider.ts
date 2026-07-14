/**
 * AuthorizationProvider — the internal swap contract for AuthZ.
 *
 * The FuzeFront authorization surface (`/api/v1/security/authz/*` + tenant /
 * member / role management) is implemented purely in terms of this interface.
 * `requirePermission` middleware calls THIS, never a vendor SDK. The first
 * concrete implementation is `PermitAuthorizationProvider` (absorbing today's
 * `utils/permit/*`, `permit/*`, `config/permit.ts`) — but it is one of many
 * possible engines.
 *
 * INTERFACE ONLY — implementations are OUT OF SCOPE for the contract freeze
 * (they belong to `backend-engineer`, Phase 2).
 *
 * Fail-closed: `check`/`bulkCheck` return `false` on any provider/transport
 * error — never throw-through as allow. Shaped from
 * `utils/permit/permission-check.ts` (`checkPermission`, `bulkCheckPermissions`,
 * `getUserPermissions`) so the existing code is the first impl with no logic
 * discarded.
 */

/** A resource reference for an authorization decision (mirrors API `ResourceRef`). */
export interface ResourceRef {
  type: string;
  /** Optional specific resource instance key. */
  key?: string;
}

/** A single authorization query. */
export interface AuthzQuery {
  /** Principal id (user or service client). */
  subject: string;
  /** Tenant/org scope for the decision. */
  tenant: string;
  resource: ResourceRef;
  action: string;
  context?: Record<string, unknown>;
}

/** A tenant (mirrors API `Tenant`). */
export interface Tenant {
  id: string;
  name: string;
  slug?: string;
}

export interface TenantCreate {
  name: string;
  slug?: string;
}

/** A tenant member (mirrors API `Member`). */
export interface Member {
  userId: string;
  email?: string;
  roles: string[];
}

export interface MemberCreate {
  userId?: string;
  email?: string;
  roles?: string[];
}

/** A role definition (mirrors API `Role`). */
export interface Role {
  key: string;
  name?: string;
}

/** Cursor-paginated page (family standard). */
export interface Page<T> {
  items: T[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
    total?: number;
  };
}

export interface PageParams {
  /** Clamped server-side to the max. */
  limit?: number;
  /** Opaque, server-issued cursor. */
  cursor?: string;
}

/**
 * The AuthZ swap contract. Providers are swappable behind it; no consumer path
 * ever imports a vendor SDK.
 */
export interface AuthorizationProvider {
  /** Single decision. Fail-closed: any error ⇒ false. */
  check(query: AuthzQuery): Promise<boolean>;

  /** Bulk decisions, index-aligned with input. Fail-closed per element. */
  bulkCheck(queries: AuthzQuery[]): Promise<boolean[]>;

  /** Effective `resource:action` grants for a subject within a tenant. */
  getPermissions(subject: string, tenant: string): Promise<string[]>;

  // ── Tenant / membership / role management (neutralized org primitives) ──

  /** List tenants visible to the caller (cursor-paginated). */
  listTenants(caller: string, params: PageParams): Promise<Page<Tenant>>;

  createTenant(input: TenantCreate): Promise<Tenant>;

  getTenant(tenantId: string): Promise<Tenant | null>;

  /** List members of a tenant (cursor-paginated). */
  listMembers(tenantId: string, params: PageParams): Promise<Page<Member>>;

  addMember(tenantId: string, input: MemberCreate): Promise<Member>;

  removeMember(tenantId: string, userId: string): Promise<void>;

  /** List the bounded, policy-defined role catalogue for a tenant. */
  listRoles(tenantId: string): Promise<Role[]>;

  /** Replace a member's role assignment within a tenant. */
  assignRoles(tenantId: string, userId: string, roles: string[]): Promise<Member>;
}
