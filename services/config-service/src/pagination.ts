/**
 * Cursor-pagination helpers shared by the config-service list endpoints
 * (FFRNT-157), following the repo's established convention (e.g.
 * `services/selection-list-service/src/routes/access.ts`,
 * `services/billing-service/src/repositories/invoice.repository.ts`): an
 * opaque, server-issued, base64url-encoded cursor carrying the sort key(s) +
 * a unique tiebreaker, decoded defensively (a malformed/stale cursor degrades
 * to "no cursor" rather than erroring).
 *
 * Response envelope matches `services/config-service/openapi.yaml`'s
 * `PageInfo` schema exactly: `{ items, pageInfo: { hasNextPage, nextCursor } }`
 * — NOT the `{ items, page: { nextCursor, hasMore } }` shape used elsewhere in
 * the repo, because this service's contract is frozen and defines its own
 * field names.
 */

export const DEFAULT_LIMIT = 50;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 200;

/** Clamp/parse the `limit` query param to [MIN_LIMIT, MAX_LIMIT], per openapi.yaml `Limit`. */
export function parseLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

export interface PageInfo {
  hasNextPage: boolean;
  nextCursor: string | null;
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Returns null for a missing, malformed, or non-object cursor — treated as page 1. */
export function decodeCursor<T extends object>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
    return null;
  } catch {
    return null;
  }
}
