/**
 * Resolved-view version computation (FFRNT-158 / FF-EPIC-17-S6), used both to
 * check `expectedVersion` (optimistic concurrency) and to report the new
 * `version` after a write applies.
 *
 * Pure, DB-free: a deterministic digest over the `(id, updatedAt)` of every
 * stored override row visible to a scope's resolution chain, for every key
 * definition in the namespace. Changes whenever ANY relevant row anywhere in
 * the chain changes — including an ancestor's row, which is what makes an
 * ancestor edit invalidate a descendant's cached version too (openapi.yaml
 * `EffectiveConfig.version`: "It changes when an ancestor changes too, so
 * inherited changes are detectable").
 *
 * NOTE for FFRNT-157 (GET /v1/config): this endpoint's `ETag` MUST be
 * produced by this exact function (or a byte-identical reimplementation) for
 * `expectedVersion` round-tripping to work — a client reads the `ETag` from a
 * GET and replays it as `expectedVersion` on the next PUT. That coordination
 * could not be made statically shared across these two branches (both are
 * developed in parallel, stacked on the same unmerged base); flagged
 * explicitly here and in the PR description as an integration point to
 * verify once both land.
 */

import { createHash } from 'crypto';
import { ConfigValue } from '../types';

export function computeResolvedVersion(rows: ConfigValue[]): string {
  const parts = rows.map((r) => `${r.id}:${r.updatedAt}`).sort();
  const digest = createHash('sha256').update(parts.join('|')).digest('hex');
  return `w1-${digest.slice(0, 32)}`;
}
