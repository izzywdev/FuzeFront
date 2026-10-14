/**
 * Calls security-service POST /internal/provision with the given userId.
 * Retries on transient HTTP 5xx with bounded exponential backoff.
 * The endpoint is idempotent so retries are safe.
 */

export interface ProvisionResult {
  ok: boolean;
  personalOrgId: string;
  reconciled: boolean;
}

export interface HttpClient {
  fetch(url: string, init: RequestInit): Promise<{ status: number; json(): Promise<any> }>;
}

/** Real HTTP client backed by Node 18 native fetch */
export const nodeFetchClient: HttpClient = {
  fetch: (url, init) => fetch(url, init),
};

const RETRY_COUNT = 3;
const RETRY_BASE_MS = 200;
const RETRY_FACTOR = 2;
const RETRY_MAX_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callProvision(
  userId: string,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<ProvisionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1), RETRY_MAX_MS);
      await sleep(delay);
    }

    const response = await http.fetch(`${securityServiceUrl}/internal/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalProvisionSecret,
      },
      body: JSON.stringify({ userId }),
    });

    if (response.status === 200) {
      const body = await response.json();
      return body as ProvisionResult;
    }

    if (response.status >= 500) {
      // Transient — retry
      lastError = new Error(`security-service returned ${response.status} (attempt ${attempt + 1})`);
      console.warn(`[provisioning-service] Transient error: ${lastError.message}`);
      continue;
    }

    // 4xx — non-retryable
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `security-service returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  throw lastError ?? new Error('callProvision: exhausted retries');
}

export interface DeprovisionResult {
  ok: boolean;
  organizationId: string;
  cascade: string;
  rolesRevoked: number;
  tenantDeleted: boolean;
}

/**
 * Calls security-service POST /internal/deprovision to tear down an org's Permit
 * access. Same retry/backoff + idempotency contract as callProvision.
 */
export async function callDeprovision(
  organizationId: string,
  cascade: string,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<DeprovisionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1), RETRY_MAX_MS);
      await sleep(delay);
    }

    const response = await http.fetch(`${securityServiceUrl}/internal/deprovision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalProvisionSecret,
      },
      body: JSON.stringify({ organizationId, cascade }),
    });

    if (response.status === 200) {
      const body = await response.json();
      return body as DeprovisionResult;
    }

    if (response.status >= 500) {
      lastError = new Error(`security-service returned ${response.status} (attempt ${attempt + 1})`);
      console.warn(`[provisioning-service] Transient error: ${lastError.message}`);
      continue;
    }

    const body = await response.json().catch(() => ({}));
    throw new Error(
      `security-service returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  throw lastError ?? new Error('callDeprovision: exhausted retries');
}

export interface UserSyncPayload {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserSyncResult {
  ok: boolean;
  userId: string;
  permitSynced: boolean;
}

/**
 * Calls security-service POST /internal/user-sync to re-sync a user's profile
 * into Permit. Same retry/backoff + idempotency contract as callProvision.
 */
export async function callUserSync(
  payload: UserSyncPayload,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<UserSyncResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1), RETRY_MAX_MS);
      await sleep(delay);
    }

    const response = await http.fetch(`${securityServiceUrl}/internal/user-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalProvisionSecret,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200) {
      const body = await response.json();
      return body as UserSyncResult;
    }

    if (response.status >= 500) {
      lastError = new Error(`security-service returned ${response.status} (attempt ${attempt + 1})`);
      console.warn(`[provisioning-service] Transient error: ${lastError.message}`);
      continue;
    }

    const body = await response.json().catch(() => ({}));
    throw new Error(
      `security-service returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  throw lastError ?? new Error('callUserSync: exhausted retries');
}

export interface UserDeleteResult {
  ok: boolean;
  userId: string;
  cascade: string;
  permitDeleted: boolean;
  sessionsRevoked: number;
}

/**
 * Calls security-service POST /internal/user-delete to tear down a user's
 * external state (Permit principal + sessions). Same retry/backoff + idempotency
 * contract as callProvision.
 */
export async function callUserDelete(
  userId: string,
  cascade: string,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<UserDeleteResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1), RETRY_MAX_MS);
      await sleep(delay);
    }

    const response = await http.fetch(`${securityServiceUrl}/internal/user-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalProvisionSecret,
      },
      body: JSON.stringify({ userId, cascade }),
    });

    if (response.status === 200) {
      const body = await response.json();
      return body as UserDeleteResult;
    }

    if (response.status >= 500) {
      lastError = new Error(`security-service returned ${response.status} (attempt ${attempt + 1})`);
      console.warn(`[provisioning-service] Transient error: ${lastError.message}`);
      continue;
    }

    const body = await response.json().catch(() => ({}));
    throw new Error(
      `security-service returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  throw lastError ?? new Error('callUserDelete: exhausted retries');
}

export interface MembershipChangePayload {
  organizationId: string;
  userId: string;
  role: string;
}

export interface MembershipChangeResult {
  ok: boolean;
  organizationId: string;
  userId: string;
  role: string;
}

async function callMembershipEndpoint(
  path: '/internal/membership-sync' | '/internal/membership-unsync',
  payload: MembershipChangePayload,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient
): Promise<MembershipChangeResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1), RETRY_MAX_MS);
      await sleep(delay);
    }

    const response = await http.fetch(`${securityServiceUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': internalProvisionSecret,
      },
      body: JSON.stringify({
        organizationId: payload.organizationId,
        userId: payload.userId,
        role: payload.role,
      }),
    });

    if (response.status === 200) {
      const body = await response.json();
      return body as MembershipChangeResult;
    }

    if (response.status >= 500) {
      lastError = new Error(`security-service returned ${response.status} (attempt ${attempt + 1})`);
      console.warn(`[provisioning-service] Transient error: ${lastError.message}`);
      continue;
    }

    const body = await response.json().catch(() => ({}));
    throw new Error(
      `security-service returned ${response.status}: ${JSON.stringify(body)}`
    );
  }

  throw lastError ?? new Error(`${path}: exhausted retries`);
}

/**
 * Calls security-service POST /internal/membership-sync to assign the Permit
 * role for a membership. Same retry/backoff + idempotency contract as
 * callProvision (assignment is idempotent, replay-safe).
 */
export function callMembershipSync(
  payload: MembershipChangePayload,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<MembershipChangeResult> {
  return callMembershipEndpoint(
    '/internal/membership-sync',
    payload,
    securityServiceUrl,
    internalProvisionSecret,
    http
  );
}

/**
 * Calls security-service POST /internal/membership-unsync to unassign the
 * Permit role for a removed membership. Same contract as callMembershipSync.
 */
export function callMembershipUnsync(
  payload: MembershipChangePayload,
  securityServiceUrl: string,
  internalProvisionSecret: string,
  http: HttpClient = nodeFetchClient
): Promise<MembershipChangeResult> {
  return callMembershipEndpoint(
    '/internal/membership-unsync',
    payload,
    securityServiceUrl,
    internalProvisionSecret,
    http
  );
}
