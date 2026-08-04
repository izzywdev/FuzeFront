import { PortalClient } from '@fuzeone/portal-client'

/**
 * Minimal shape the boot provider depends on — lets tests inject a fake
 * without constructing a real axios-backed `PortalClient`.
 */
export interface PortalContextSource {
  getPortalContext(): Promise<unknown>
}

/**
 * Same-origin `PortalClient` (baseUrl `''`) — never an absolute host, so the
 * boot request works identically under local TLS and prod ingress.
 */
export function createPortalClient(): PortalContextSource {
  return new PortalClient({ baseUrl: '' })
}
