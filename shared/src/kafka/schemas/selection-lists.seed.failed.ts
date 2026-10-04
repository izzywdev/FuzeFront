import { z } from 'zod';
import {
  SELECTION_LIST_LIMITS,
  slItemCodeV1,
  slListKeyV1,
  slSeedOutcomeBaseV1,
} from './selection-lists.common';

/**
 * Why a seed was rejected. Nothing was written for ANY of these — a seed is
 * all-or-nothing. `retryable` on the event says whether re-sending the SAME
 * request (same content, fresh attestation) can succeed later without a
 * content change; the default per code is listed in the plan.
 *
 *   SCOPE_UNSUPPORTED      scope 'user' — no user-scoped list model exists yet
 *   SEEDING_DISABLED       fuzefront.selection-lists.seed-defaults is OFF for this org      (retryable)
 *   ATTESTATION_INVALID    token inactive/expired, or lacks scope selection-lists:seed     (retryable)
 *   SOURCE_NOT_ALLOWED     source.app not in seed_sources, disabled, or token subject not bound to it
 *   NAMESPACE_VIOLATION    a list key outside the source's allowed key prefixes
 *   LIMIT_EXCEEDED         beyond the source's per-request caps (lists / items)
 *   QUOTA_EXCEEDED         would exceed the org's list quota or a list's item quota            (retryable)
 *   KEY_CONFLICT           a list key is taken by a list this source+pack did not seed         (retryable)
 *   PACK_CONTENT_MISMATCH  same (source, pack, version) already applied with DIFFERENT content
 *   ORG_UNKNOWN            organization not (yet) known to the service's org projection      (retryable)
 *   ORG_INACTIVE           organization is deactivated or deleted
 *   VALIDATION_ERROR       the request failed schema validation (best-effort; also dead-lettered)
 *   INTERNAL_ERROR         unexpected failure after retries were exhausted                    (retryable)
 */
export const SELECTION_LIST_SEED_FAILURE_REASONS = [
  'SCOPE_UNSUPPORTED',
  'SEEDING_DISABLED',
  'ATTESTATION_INVALID',
  'SOURCE_NOT_ALLOWED',
  'NAMESPACE_VIOLATION',
  'LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'KEY_CONFLICT',
  'PACK_CONTENT_MISMATCH',
  'ORG_UNKNOWN',
  'ORG_INACTIVE',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
] as const;

/** `selection-lists.seed.failed` — the request was rejected; nothing was written. Never echoes the attestation. */
export const selectionListsSeedFailedSchemaV1 = slSeedOutcomeBaseV1.extend({
  reason: z.enum(SELECTION_LIST_SEED_FAILURE_REASONS),
  message: z.string().min(1).max(SELECTION_LIST_LIMITS.MESSAGE_MAX),
  retryable: z.boolean(),
  details: z
    .array(
      z.object({
        listKey: slListKeyV1.optional(),
        itemCode: slItemCodeV1.optional(),
        /** JSON path into the request, e.g. "lists.0.items.3.code". */
        path: z.string().max(256).optional(),
        /** For QUOTA_EXCEEDED / LIMIT_EXCEEDED. */
        quotaScope: z.enum(['org_lists', 'list_items', 'request_lists', 'request_items']).optional(),
        limit: z.number().int().nonnegative().optional(),
        current: z.number().int().nonnegative().optional(),
        requested: z.number().int().nonnegative().optional(),
      }),
    )
    .max(50),
});

export type SelectionListsSeedFailedPayloadV1 = z.infer<typeof selectionListsSeedFailedSchemaV1>;
