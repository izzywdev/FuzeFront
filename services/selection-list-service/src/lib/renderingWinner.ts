// lib/renderingWinner.ts - THE winner rule for one key (or one fork) held by one organization under SEVERAL
// renderings of its id (bare UUID / `org_...` TypeID). Pure: no database, no I/O, no flags.
//
// It lives apart from services/sharedReads.ts so that everything that must agree on "who wins" imports ONE
// definition, including the rollout jobs (src/rollout/*), which run as a CLI and must not load the HTTP/authz stack:
//   - the read path (listing, `?key=`, fork lookups, resolve redirect, shadowing) via services/sharedReads.ts,
//     which re-exports everything below unchanged;
//   - the duplicate-key audit / reconcile job, which keeps the winner and renames + archives the rest.
// Do not re-implement the order anywhere else.

/**
 * ONE deterministic answer per key when an organization holds the same key under SEVERAL renderings of its id.
 *
 * `(organization_id, key)` is unique per stored string, so rows created under both the bare UUID and the `org_...`
 * TypeID (possible while shared lists were OFF, or from older data) can coexist, and the rendering-aware own-org
 * scope merges them into one org. Every consumer that resolves "the list for this key" must pick the SAME row:
 *
 *   1. an ACTIVE row over an archived one;
 *   2. the row whose organization_id equals the caller's claim EXACTLY;
 *   3. the oldest (`created_at`), then the smallest `id`.
 *
 * `rendering_winner_order(claim)` is that order as an ORDER BY fragment (first row wins);
 * `notOutrankedByRendering(alias, renderings, claim)` is the WHERE predicate that keeps a row only if no row of the
 * same org-group and key outranks it (so a listing returns exactly one row per key).
 */
export function renderingWinnerOrder(alias: string, claim: string): { sql: string; params: string[] } {
  const p = alias ? `${alias}.` : '';
  return { sql: `(${p}status = 'active') DESC, (${p}organization_id = ?) DESC, ${p}created_at ASC, ${p}id ASC`, params: [claim] };
}

export function notOutrankedByRendering(alias: string, renderings: string[], claim: string): { sql: string; params: Array<string | string[]> } {
  const p = alias ? `${alias}.` : '';
  return {
    sql: `NOT EXISTS (
      SELECT 1 FROM selection_lists d
       WHERE ${p}organization_id = ANY(?) AND d.organization_id = ANY(?) AND d.key = ${p}key AND d.id <> ${p}id
         AND ( (d.status = 'active' AND ${p}status <> 'active')
            OR ( (d.status = 'active') = (${p}status = 'active')
                 AND ( (d.organization_id = ? AND ${p}organization_id <> ?)
                    OR ( (d.organization_id = ?) = (${p}organization_id = ?)
                         AND (d.created_at < ${p}created_at OR (d.created_at = ${p}created_at AND d.id < ${p}id)) ) ) ) ) )`,
    params: [renderings, renderings, claim, claim, claim, claim],
  };
}

export interface DupRow {
  id: string;
  organization_id: string;
  key: string;
  status: string;
  visibility?: string | null;
  created_at: Date | string;
}

const ts = (v: Date | string): number => new Date(v).getTime();

/**
 * `rows` ordered by the winner rule, winner first: an active row over an archived one, then the row stored under the
 * caller's `claim` exactly, then the oldest (`created_at`), then the smallest `id`. Pass a claim that no row carries
 * (e.g. '') for a caller-independent order (the rollout reconcile job does).
 */
export function rankRows<T extends DupRow>(rows: T[], claim: string): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active') ||
      Number(b.organization_id === claim) - Number(a.organization_id === claim) ||
      ts(a.created_at) - ts(b.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The winner among `rows` (already filtered to what the caller can read) for a caller whose claim is `claim`. */
export function pickWinner<T extends DupRow>(rows: T[], claim: string): T | undefined {
  return rankRows(rows, claim)[0];
}
