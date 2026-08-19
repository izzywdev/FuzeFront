// platform-client.ts — thin REST client the mutating tools use to act on the
// FuzeFront backend on behalf of the caller. It forwards the caller's JWT so the
// backend re-enforces its own auth + Permit checks (defence in depth — the
// chat-service Permit gate is the FIRST check, the backend is the SECOND).
//
// Fail-loud: non-2xx responses throw, so the executor records a failed audit
// row and streams a tool_result(success:false). Mockable via fetchImpl.

export interface PlatformClientConfig {
  /** Backend base URL, e.g. http://fuzefront-backend:3001 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  parent_id?: string;
}

export interface UpdateOrgSettingsInput {
  orgId: string;
  patch: Record<string, unknown>;
}

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PlatformClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) detail = j.error;
      } catch {
        /* ignore non-JSON error bodies */
      }
      throw new Error(`Backend request failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  createOrganization(input: CreateOrgInput, token: string): Promise<{ id: string; name: string }> {
    return this.request('POST', '/api/organizations', token, input);
  }

  updateOrganizationSettings(
    input: UpdateOrgSettingsInput,
    token: string,
  ): Promise<{ id: string }> {
    return this.request('PUT', `/api/organizations/${input.orgId}`, token, input.patch);
  }
}
