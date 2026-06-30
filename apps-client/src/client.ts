import axios, { type AxiosInstance } from 'axios';
import type {
  App,
  AppManifest,
  AppRegistryClientConfig,
  HeartbeatRequest,
  ListAppsParams,
  ListAppsResult,
  RegisterAppRequest,
} from './types';

/**
 * Typed client for the FuzeFront app-registry API. Every method maps 1:1 to an
 * operationId in `services/app-registry-service/openapi.yaml`. The host, the
 * registration UI, and the contract tests all import this same client, so a
 * contract change becomes a compile error.
 */
export class AppRegistryClient {
  private readonly http: AxiosInstance;

  constructor(config: AppRegistryClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ''),
      timeout: config.timeoutMs ?? 10_000,
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
    });
  }

  /** GET /apps — list apps visible to the caller. */
  async listApps(params: ListAppsParams = {}): Promise<ListAppsResult> {
    const { data } = await this.http.get<ListAppsResult>('/apps', { params });
    return data;
  }

  /** GET /apps/{slug} — read a single app + its manifest. */
  async getApp(slug: string): Promise<App> {
    const { data } = await this.http.get<App>(`/apps/${encodeURIComponent(slug)}`);
    return data;
  }

  /** POST /apps — register an app from its manifest (starts `registered`). */
  async registerApp(body: RegisterAppRequest): Promise<App> {
    const { data } = await this.http.post<App>('/apps', body);
    return data;
  }

  /** PUT /apps/{slug} — replace an app's manifest. */
  async updateApp(slug: string, manifest: AppManifest): Promise<App> {
    const { data } = await this.http.put<App>(
      `/apps/${encodeURIComponent(slug)}`,
      manifest,
    );
    return data;
  }

  /** DELETE /apps/{slug} — delete a registered (non-builtin) app. */
  async deleteApp(slug: string): Promise<void> {
    await this.http.delete(`/apps/${encodeURIComponent(slug)}`);
  }

  /** POST /apps/{slug}/activate — make the app visible in the menu. */
  async activateApp(slug: string): Promise<App> {
    const { data } = await this.http.post<App>(
      `/apps/${encodeURIComponent(slug)}/activate`,
    );
    return data;
  }

  /** POST /apps/{slug}/suspend — hide the app (record retained). */
  async suspendApp(slug: string): Promise<App> {
    const { data } = await this.http.post<App>(
      `/apps/${encodeURIComponent(slug)}/suspend`,
    );
    return data;
  }

  /** POST /apps/{slug}/heartbeat — app liveness (uses an app heartbeat token). */
  async heartbeat(
    slug: string,
    body: HeartbeatRequest,
    heartbeatToken: string,
  ): Promise<{ accepted: boolean; at: string }> {
    const { data } = await this.http.post<{ accepted: boolean; at: string }>(
      `/apps/${encodeURIComponent(slug)}/heartbeat`,
      body,
      { headers: { Authorization: `Bearer ${heartbeatToken}` } },
    );
    return data;
  }
}
