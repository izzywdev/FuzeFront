type TenantOrganization = { id: string; type?: string }

/**
 * Resolve the tenant published to federated products without waiting for
 * organization metadata hydration. A persisted organization selection is
 * already account-scoped and must win over the Personal tenant until the host
 * explicitly reconciles or changes that selection.
 */
export function resolveFederatedTenantId(input: {
  activeOrganizationId: string | null
  organizations: readonly TenantOrganization[]
  personalTenantId: string | null
}): string | null {
  if (input.activeOrganizationId) return input.activeOrganizationId
  return input.personalTenantId
    ?? input.organizations.find(organization => organization.type === 'personal')?.id
    ?? null
}
