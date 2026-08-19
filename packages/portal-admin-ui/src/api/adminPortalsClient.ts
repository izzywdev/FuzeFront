/**
 * S2 — master-admin portal fleet API. Thin wrapper over the generated
 * `@fuzefront/portal-client` (services/portal-service/openapi.yaml is its
 * source of truth); every method here maps 1:1 onto a `PortalClient` method
 * so the shape of a portal row stays a compile-time link to the frozen
 * contract, exactly as `frontend/src/services/adminPortalsService.ts` already
 * does for the Portals Directory feature.
 *
 * A fresh `PortalClient` is constructed per call (cheap — just `axios.create`)
 * so the bearer token always reflects the CURRENT active account, matching
 * this package's `getToken` callback convention rather than baking a token in
 * at client-construction time.
 */
import { PortalClient } from '@fuzefront/portal-client'
import type {
  AdminPortalsPage,
  CreatePortalInput,
  ListAdminPortalsParams,
  Portal,
  PortalStatus,
} from '../types'

export interface AdminPortalsClientOptions {
  /** Same-origin base URL. Default ''. */
  baseUrl?: string
  getToken?: () => string | null | undefined
}

export interface AdminPortalsClient {
  listPortals(params?: ListAdminPortalsParams): Promise<AdminPortalsPage>
  createPortal(input: CreatePortalInput): Promise<Portal>
  getPortal(portalId: string): Promise<Portal>
  suspendPortal(portalId: string): Promise<Portal>
  resumePortal(portalId: string): Promise<Portal>
}

export function createAdminPortalsClient(opts: AdminPortalsClientOptions = {}): AdminPortalsClient {
  const makeClient = () =>
    new PortalClient({ baseUrl: opts.baseUrl ?? '', token: opts.getToken?.() ?? undefined })

  return {
    async listPortals(params = {}) {
      const page = await makeClient().listPortals({
        status: params.status as PortalStatus | undefined,
        q: params.q,
        limit: params.limit,
        cursor: params.cursor,
      })
      return {
        items: page.items,
        page: { nextCursor: page.page.nextCursor, hasMore: page.page.nextCursor !== null, total: page.page.total },
      }
    },
    createPortal(input) {
      return makeClient().createPortal({
        name: input.name,
        slug: input.slug,
        ownerEmail: input.ownerEmail,
        billingMode: input.billingMode,
      })
    },
    getPortal(portalId) {
      return makeClient().getPortal(portalId)
    },
    suspendPortal(portalId) {
      return makeClient().suspendPortal(portalId)
    },
    resumePortal(portalId) {
      return makeClient().resumePortal(portalId)
    },
  }
}
