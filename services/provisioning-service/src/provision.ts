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
