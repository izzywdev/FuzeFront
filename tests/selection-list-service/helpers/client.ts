/**
 * Typed SelectionListClient factory pointed at the test service instance.
 *
 * Service URL is read from SERVICE_BASE_URL (default http://localhost:3011).
 * Uses Node 18+ native fetch — no external dependency needed.
 */
import { SelectionListClient } from '@fuzeone/selection-list-client';

export const SERVICE_BASE_URL: string =
  process.env['SERVICE_BASE_URL'] ?? 'http://localhost:3011';

/** Build a client for the given bearer token. */
export function makeClient(token?: string | (() => string)): SelectionListClient {
  return new SelectionListClient({
    baseUrl: SERVICE_BASE_URL,
    token,
    // Node 18+ native fetch is globalThis.fetch; the client falls back to it
    // automatically when no fetch option is provided.
  });
}

/** Raw fetch bypassing the typed client — for edge-case status/body assertions. */
export async function rawFetch(
  path: string,
  init: { method?: string; body?: string; token?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: unknown }> {
  const { token, headers: extraHeaders, ...rest } = init;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${SERVICE_BASE_URL}${path}`, {
    ...rest,
    headers,
  });
  let body: unknown = null;
  try {
    const text = await res.text();
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // leave body as null
  }
  return { status: res.status, body };
}
