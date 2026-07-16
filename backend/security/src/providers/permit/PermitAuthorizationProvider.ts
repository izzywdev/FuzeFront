/**
 * PermitAuthorizationProvider — the first concrete `AuthorizationProvider`.
 *
 * Wraps Permit.io (the policy/ReBAC engine) behind FuzeFront's neutral AuthZ
 * swap contract. This file is the ONLY place the vendor is named; every route,
 * middleware, and consumer path talks to the `AuthorizationProvider` interface,
 * so the engine is swappable without any consumer change.
 *
 * It reuses the existing, battle-tested `utils/permit/*` helpers (already
 * fail-closed and CI-no-op aware) so no logic is discarded — this class is the
 * neutral surface over them.
 *
 * Fail-closed everywhere: `check`/`bulkCheck` return `false` on any error; the
 * read helpers return empty; writes surface a thrown error only for genuine
 * caller mistakes (never silently "allow").
 */
import type {
  AuthorizationProvider,
  AuthzQuery,
  Grant,
  GrantQuery,
  GrantRequest,
  GrantRevokeRequest,
  Member,
  MemberCreate,
  Page,
  PageParams,
  Role,
  Tenant,
  TenantCreate,
} from '../AuthorizationProvider'
import permit from '../../config/permit'
import {
  checkPermission,
  bulkCheckPermissions,
  getUserPermissions,
} from '../../utils/permit/permission-check'
import {
  assignRoleInPermit,
  unassignRoleInPermit,
  getUserRoleAssignments,
  getTenantRoleAssignments,
} from '../../utils/permit/role-assignment'
import {
  getTenantFromPermit,
  listTenantsFromPermit,
} from '../../utils/permit/tenant-management'

/** Compose the Permit resource-instance key `type:key` (ReBAC scope). */
function resourceInstance(
  resource?: { type: string; key?: string }
): string | undefined {
  if (!resource?.key) return undefined
  return `${resource.type}:${resource.key}`
}

/** Single, unpaginated page (Permit's list APIs are not cursor-native here). */
function singlePage<T>(items: T[]): Page<T> {
  return { items, page: { nextCursor: null, hasMore: false, total: items.length } }
}

/** Best-effort map of an unknown Permit role-assignment row → its role key. */
function roleKeyOf(a: any): string | undefined {
  return a?.role ?? a?.role_key ?? undefined
}

export class PermitAuthorizationProvider implements AuthorizationProvider {
  // ── Decisions (read-side, already fail-closed in the helpers) ──

  async check(query: AuthzQuery): Promise<boolean> {
    return checkPermission({
      user: query.subject,
      action: query.action,
      resource: {
        type: query.resource.type,
        tenant: query.tenant,
        key: query.resource.key,
      },
      context: query.context as Record<string, any> | undefined,
    })
  }

  async bulkCheck(queries: AuthzQuery[]): Promise<boolean[]> {
    if (queries.length === 0) return []
    return bulkCheckPermissions(
      queries.map(q => ({
        user: q.subject,
        action: q.action,
        resource: { type: q.resource.type, tenant: q.tenant, key: q.resource.key },
        context: q.context as Record<string, any> | undefined,
      }))
    )
  }

  async getPermissions(subject: string, tenant: string): Promise<string[]> {
    const raw = (await getUserPermissions(subject, tenant)) as
      | Record<string, { permissions?: string[] }>
      | Record<string, string[]>
      | undefined
    if (!raw) return []
    // Permit keys the result by tenant; each entry is either a bare string[]
    // of `resource:action`, or an object exposing `.permissions`.
    const out = new Set<string>()
    for (const value of Object.values(raw)) {
      const perms = Array.isArray(value) ? value : value?.permissions
      for (const p of perms ?? []) out.add(p)
    }
    return [...out]
  }

  // ── Grants (write-side) ──

  async grant(req: GrantRequest): Promise<Grant> {
    const ok = await assignRoleInPermit({
      user: req.subject,
      role: req.role,
      tenant: req.tenant,
      resource_instance: resourceInstance(req.resource),
    })
    if (!ok) throw new Error('grant failed')
    return {
      id: `${req.tenant}:${req.subject}:${req.role}`,
      subject: req.subject,
      tenant: req.tenant,
      role: req.role,
      permission: req.permission,
      resource: req.resource,
    }
  }

  async revoke(req: GrantRevokeRequest): Promise<void> {
    // Support the identity-tuple form (Permit unassigns by user+role+tenant).
    // A grantId of the `tenant:subject:role` shape is decomposed if present.
    let subject = req.subject
    let tenant = req.tenant
    let role = req.role
    if (req.grantId && (!subject || !tenant || !role)) {
      const [gTenant, gSubject, gRole] = req.grantId.split(':')
      subject = subject ?? gSubject
      tenant = tenant ?? gTenant
      role = role ?? gRole
    }
    if (!subject || !tenant || !role) {
      throw new Error('revoke requires grantId or subject+tenant+role')
    }
    // Idempotent: the helper returns false (not throws) if the assignment is
    // already gone, which we treat as success.
    await unassignRoleInPermit({ user: subject, role, tenant })
  }

  async listGrants(query: GrantQuery): Promise<Page<Grant>> {
    const rows = (await getUserRoleAssignments(query.subject, query.tenant)) as any[]
    const grants: Grant[] = (rows ?? [])
      .map(r => {
        const role = roleKeyOf(r)
        if (!role) return null
        return {
          id: `${query.tenant}:${query.subject}:${role}`,
          subject: query.subject,
          tenant: query.tenant,
          role,
        } as Grant
      })
      .filter((g): g is Grant => g !== null)
    return singlePage(grants)
  }

  // ── Tenants / membership / roles ──

  async listTenants(_caller: string, _params: PageParams): Promise<Page<Tenant>> {
    const raw = (await listTenantsFromPermit()) as any
    const rows: any[] = Array.isArray(raw) ? raw : (raw?.data ?? [])
    const tenants: Tenant[] = rows.map(t => ({
      id: t.key ?? t.id,
      name: t.name ?? t.key,
      slug: t.attributes?.slug ?? t.slug,
    }))
    return singlePage(tenants)
  }

  async createTenant(input: TenantCreate): Promise<Tenant> {
    const key = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await permit.api.tenants.create({
      key,
      name: input.name,
      attributes: input.slug ? { slug: input.slug } : undefined,
    })
    return { id: key, name: input.name, slug: input.slug }
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const t = (await getTenantFromPermit(tenantId)) as any
    if (!t) return null
    return {
      id: t.key ?? t.id ?? tenantId,
      name: t.name ?? tenantId,
      slug: t.attributes?.slug ?? t.slug,
    }
  }

  async listMembers(tenantId: string, _params: PageParams): Promise<Page<Member>> {
    const rows = (await getTenantRoleAssignments(tenantId)) as any[]
    // Collapse a user's multiple role rows into one Member with all roles.
    const byUser = new Map<string, Member>()
    for (const r of rows ?? []) {
      const userId = r.user ?? r.user_id
      const role = roleKeyOf(r)
      if (!userId) continue
      const existing = byUser.get(userId)
      if (existing) {
        if (role && !existing.roles.includes(role)) existing.roles.push(role)
      } else {
        byUser.set(userId, { userId, email: r.user_email, roles: role ? [role] : [] })
      }
    }
    return singlePage([...byUser.values()])
  }

  async addMember(tenantId: string, input: MemberCreate): Promise<Member> {
    const userId = input.userId
    if (!userId) throw new Error('addMember requires userId')
    const roles = input.roles?.length ? input.roles : ['viewer']
    for (const role of roles) {
      const ok = await assignRoleInPermit({ user: userId, role, tenant: tenantId })
      if (!ok) throw new Error(`failed to assign role ${role}`)
    }
    return { userId, email: input.email, roles }
  }

  async removeMember(tenantId: string, userId: string): Promise<void> {
    const rows = (await getUserRoleAssignments(userId, tenantId)) as any[]
    for (const r of rows ?? []) {
      const role = roleKeyOf(r)
      if (role) await unassignRoleInPermit({ user: userId, role, tenant: tenantId })
    }
  }

  async listRoles(_tenantId: string): Promise<Role[]> {
    try {
      const raw = (await permit.api.roles.list()) as any
      const rows: any[] = Array.isArray(raw) ? raw : (raw?.data ?? [])
      return rows.map(r => ({ key: r.key, name: r.name }))
    } catch (err) {
      console.error('listRoles failed (returning empty catalogue):', err)
      return []
    }
  }

  async assignRoles(
    tenantId: string,
    userId: string,
    roles: string[]
  ): Promise<Member> {
    // Replace: drop existing assignments, then apply the requested set.
    await this.removeMember(tenantId, userId)
    for (const role of roles) {
      const ok = await assignRoleInPermit({ user: userId, role, tenant: tenantId })
      if (!ok) throw new Error(`failed to assign role ${role}`)
    }
    return { userId, roles }
  }
}
