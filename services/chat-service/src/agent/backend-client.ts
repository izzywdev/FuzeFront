// backend-client.ts — thin typed HTTP client the mutating tools use to perform
// the REAL platform action against fuzefront-backend (plan §6d).
//
// chat-service never mutates the platform DB directly: it calls the same
// fuzefront-backend organization endpoints a human would, forwarding the
// caller's bearer JWT so the backend re-applies its own authz. (chat-service
// also re-checks Permit at the confirmation gate — defense in depth, §10c.)
//
// fetchImpl is injectable so tests assert URL/method/headers/body without IO.

export interface BackendActionClientConfig {
  /** fuzefront-backend base URL, e.g. http://fuzefront-backend:3001 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  description?: string;
}

export interface InviteMemberInput {
  orgId: string;
  email: string;
  role: string;
}

export interface UpdateOrgSettingsInput {
  orgId: string;
  settings: Record<string, unknown>;
}

export class BackendActionClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: BackendActionClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** POST /api/organizations — create an organization. */
  async createOrg(token: string, input: CreateOrgInput): Promise<unknown> {
    return this.send('POST', '/api/organizations', token, {
      name: input.name,
      slug: input.slug,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
  }

  /** POST /api/organizations/:id/invitations — invite a member. */
  async inviteMember(token: string, input: InviteMemberInput): Promise<unknown> {
    return this.send(
      'POST',
      `/api/organizations/${encodeURIComponent(input.orgId)}/invitations`,
      token,
      { email: input.email, role: input.role },
    );
  }

  /** PUT /api/organizations/:id — update organization settings. */
  async updateOrgSettings(token: string, input: UpdateOrgSettingsInput): Promise<unknown> {
    return this.send(
      'PUT',
      `/api/organizations/${encodeURIComponent(input.orgId)}`,
      token,
      input.settings,
    );
  }

  private async send(
    method: 'POST' | 'PUT',
    path: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore body read failure */
      }
      throw new Error(
        `Backend request ${method} ${path} failed: ${res.status}${detail ? ` ${detail}` : ''}`,
      );
    }
    return res.json();
  }
}
