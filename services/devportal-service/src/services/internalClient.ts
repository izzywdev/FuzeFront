// internalClient.ts — calls backend/security's internal, S2S-only
// provisioning endpoints (routes/internal.ts). devportal-service does not
// own the `users`/`organization_memberships` tables, so account
// find-or-create and root-org `developer` provisioning are single-sourced
// there — see docs/planning/developers-portal.md §5.2.

const SECURITY_SERVICE_URL = process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002';
const INTERNAL_SECRET = process.env.INTERNAL_PROVISION_SECRET;

async function postInternal<T>(path: string, body: unknown): Promise<T> {
  if (!INTERNAL_SECRET) {
    throw new Error('INTERNAL_PROVISION_SECRET is not set');
  }
  const res = await fetch(`${SECURITY_SERVICE_URL}/internal${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`security-service ${path} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface OidcSyncResult {
  ok: true;
  userId: string;
  email: string;
}

/** Resolves OIDC userinfo claims to a FuzeFront user id (find-or-create by email). */
export async function syncOidcUser(userinfo: Record<string, unknown>): Promise<OidcSyncResult> {
  return postInternal<OidcSyncResult>('/oidc-sync', { userinfo });
}

/** Provisions the resolved user as a root-org `developer` (idempotent). */
export async function provisionDeveloper(userId: string): Promise<void> {
  await postInternal<{ ok: true }>('/devportal-provision', { userId });
}
