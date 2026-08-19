import axios, { type AxiosInstance } from 'axios';
import { CustomHostnameApiError } from './errors';
import type {
  CreateCustomHostnameRequest,
  CustomHostname,
  CustomHostnameClientConfig,
  CustomHostnameList,
  Health,
  ListCustomHostnamesParams,
} from './types';

/** In-cluster service DNS — the only supported production address. */
export const DEFAULT_BASE_URL =
  'http://custom-hostname-api.fuzeinfra.svc.cluster.local:8080';

/**
 * Typed client for FuzeInfra's Custom Hostname API. Every method maps 1:1 to an
 * operationId in `services/custom-hostname-api/openapi.yaml`, so a contract
 * change becomes a compile error rather than a runtime surprise.
 *
 * The service is cluster-internal and bearer-authenticated. The token selects
 * our route profile, which pins the namespace and Service our domains may be
 * routed to — we can only ever create Ingresses pointing at `fuzefront-frontend`
 * in the `fuzefront` namespace.
 */
export class CustomHostnameClient {
  private readonly http: AxiosInstance;
  private readonly profile?: string;

  constructor(config: CustomHostnameClientConfig) {
    this.profile = config.profile;
    this.http = axios.create({
      baseURL: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
      timeout: config.timeoutMs ?? 10_000,
      headers: { Authorization: `Bearer ${config.token}` },
      // We translate every non-2xx into a typed CustomHostnameApiError rather
      // than letting axios throw an untyped one, so callers always get `code`.
      validateStatus: () => true,
    });
  }

  /**
   * POST /custom-hostnames — begin validation + certificate issuance.
   *
   * Idempotent by contract: re-posting a known domain returns `200` with the
   * existing record instead of `409`, so a reconcile loop is safe to re-run.
   * Re-POSTing is also the documented **retry** for a `failed`/`expired`
   * certificate.
   *
   * Throws `CustomHostnameApiError` with code `validation_error` (422) for a
   * wildcard, a malformed domain, or anything inside `fuzefront.com` — those are
   * already served by the wildcard Ingress rule and must not be sent here.
   * Throws code `quota_exceeded` (429) when the custom-hostname cap is reached;
   * that is a real error to surface, not something to retry.
   */
  async createCustomHostname(domain: string): Promise<CustomHostname> {
    const body: CreateCustomHostnameRequest = this.profile
      ? { domain, profile: this.profile }
      : { domain };
    const res = await this.http.post('/custom-hostnames', body);
    if (res.status !== 200 && res.status !== 201) {
      throw CustomHostnameApiError.fromResponse(res.status, res.data);
    }
    return res.data as CustomHostname;
  }

  /**
   * GET /custom-hostnames/{domain} — poll validation, certificate, and routing.
   *
   * Each call costs a Cloudflare API call upstream. Do not poll faster than
   * every 10s per domain; prefer `pollUntilSettled`, which encodes the
   * documented schedule.
   */
  async getCustomHostname(domain: string): Promise<CustomHostname> {
    const res = await this.http.get(`/custom-hostnames/${encodeURIComponent(domain)}`);
    if (res.status !== 200) {
      throw CustomHostnameApiError.fromResponse(res.status, res.data);
    }
    return res.data as CustomHostname;
  }

  /** GET /custom-hostnames — the calling consumer's own domains, paginated. */
  async listCustomHostnames(
    params: ListCustomHostnamesParams = {}
  ): Promise<CustomHostnameList> {
    const res = await this.http.get('/custom-hostnames', { params });
    if (res.status !== 200) {
      throw CustomHostnameApiError.fromResponse(res.status, res.data);
    }
    return res.data as CustomHostnameList;
  }

  /**
   * DELETE /custom-hostnames/{domain} — deprovision.
   *
   * Idempotent by contract: an unknown domain also returns `204`, so a
   * best-effort cleanup never has to pre-check existence.
   */
  async deleteCustomHostname(domain: string): Promise<void> {
    const res = await this.http.delete(`/custom-hostnames/${encodeURIComponent(domain)}`);
    if (res.status !== 204) {
      throw CustomHostnameApiError.fromResponse(res.status, res.data);
    }
  }

  /** GET /readyz — unauthenticated readiness probe. */
  async readyz(): Promise<Health> {
    const res = await this.http.get('/readyz');
    return res.data as Health;
  }
}
