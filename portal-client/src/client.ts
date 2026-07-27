import axios, { type AxiosInstance } from 'axios';
import type {
  Portal,
  PortalContext,
  PortalCreate,
  PortalUpdate,
  PortalPage,
  PortalClientConfig,
  ListPortalsParams,
} from './types';

/**
 * Typed client for the FuzeFront portal API. Every method maps 1:1 to an
 * operationId in `services/portal-service/openapi.yaml`. The shell, the
 * master-admin console, the portal-admin console, and the contract tests all
 * import this same client, so a contract change becomes a compile error.
 */
export class PortalClient {
  private readonly http: AxiosInstance;

  constructor(config: PortalClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      timeout: config.timeoutMs ?? 10_000,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    });
  }

  // --- Public / self ------------------------------------------------------

  /** GET /api/v1/portal/context — public boot context for the current host. */
  async getPortalContext(): Promise<PortalContext> {
    const { data } = await this.http.get<PortalContext>('/api/v1/portal/context');
    return data;
  }

  /** GET /api/v1/portal/current — the authenticated caller's own portal. */
  async getCurrentPortal(): Promise<Portal> {
    const { data } = await this.http.get<Portal>('/api/v1/portal/current');
    return data;
  }

  // --- Master-admin CRUD --------------------------------------------------

  /** GET /api/v1/admin/portals — cursor-paginated fleet list (platform-admin). */
  async listPortals(params: ListPortalsParams = {}): Promise<PortalPage> {
    const { data } = await this.http.get<PortalPage>('/api/v1/admin/portals', {
      params,
    });
    return data;
  }

  /** POST /api/v1/admin/portals — provision a new portal (platform-admin). */
  async createPortal(body: PortalCreate): Promise<Portal> {
    const { data } = await this.http.post<Portal>('/api/v1/admin/portals', body);
    return data;
  }

  /** GET /api/v1/admin/portals/{portalId} — read one portal (platform-admin). */
  async getPortal(portalId: string): Promise<Portal> {
    const { data } = await this.http.get<Portal>(
      `/api/v1/admin/portals/${encodeURIComponent(portalId)}`,
    );
    return data;
  }

  /**
   * PATCH /api/v1/admin/portals/{portalId} — partial update. Setting
   * `status` performs suspend/resume (the transition the fleet list binds to).
   */
  async updatePortal(portalId: string, body: PortalUpdate): Promise<Portal> {
    const { data } = await this.http.patch<Portal>(
      `/api/v1/admin/portals/${encodeURIComponent(portalId)}`,
      body,
    );
    return data;
  }

  /** POST /api/v1/admin/portals/{portalId}/suspend — semantic suspend action. */
  async suspendPortal(portalId: string): Promise<Portal> {
    const { data } = await this.http.post<Portal>(
      `/api/v1/admin/portals/${encodeURIComponent(portalId)}/suspend`,
    );
    return data;
  }

  /** POST /api/v1/admin/portals/{portalId}/resume — semantic resume action. */
  async resumePortal(portalId: string): Promise<Portal> {
    const { data } = await this.http.post<Portal>(
      `/api/v1/admin/portals/${encodeURIComponent(portalId)}/resume`,
    );
    return data;
  }
}
