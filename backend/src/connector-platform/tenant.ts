/** Resource organization selector. This is configuration, never membership proof. */
export function connectorResourceTenant(configured?: string): string {
  const tenant = configured ?? process.env.FUZE_CONNECTOR_AUTHZ_TENANT
  if (typeof tenant !== 'string' || !tenant || tenant.length > 255 || /\s/.test(tenant)) {
    throw new Error('Connector resource organization is not configured')
  }
  // Security canonicalizes this organization and freshly verifies SQL membership.
  return tenant
}
