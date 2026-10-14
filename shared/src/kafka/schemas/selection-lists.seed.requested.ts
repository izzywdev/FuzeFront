import { z } from 'zod';
import {
  PLATFORM_SEED_SOURCE,
  SELECTION_LIST_LIMITS,
  SELECTION_LIST_SEED_REQUEST_ID_PATTERN,
  refineSeedLists,
  slOrganizationIdV1,
  slSeedListSpecV1,
  slSeedScopeV1,
  slSeedTriggerV1,
  slSlugV1,
  slUserIdV1,
} from './selection-lists.common';

/**
 * `selection-lists.seed.requested` — INBOUND. Another service asks the
 * selection-list-service to seed a versioned pack of lists for its app into an
 * organization. This is the ONE selection-lists topic the service consumes
 * rather than produces; every other `selection-lists.*` topic is produced only
 * by selection-list-service.
 *
 * The request is a create-shaped body, so it follows the identifier standard:
 * no `id` anywhere (lists and items are minted by the service) and every
 * object is `.strict()` so an unknown field — including a smuggled `id` — is a
 * validation failure, not a silently-dropped key.
 *
 * Trust: the topic itself is not authenticated today (FuzeInfra Kafka has no
 * SASL/ACLs), so the request carries an `attestation` — a short-lived service
 * token with scope `selection-lists:seed`, introspected by the consumer and
 * matched against the `seed_sources` allowlist for `source.app`. See
 * docs/planning/selection-lists-events.md §"Trust model".
 *
 * Outcome: exactly one `selection-lists.seed.completed` or
 * `selection-lists.seed.failed` per processed request, echoing `requestId`.
 */
export const selectionListsSeedRequestedSchemaV1 = z
  .object({
    /**
     * Caller-chosen idempotency key, echoed on the outcome event. Prefer a
     * deterministic value (e.g. `<app>:<org>:<packKey>:v<version>`) so a
     * re-send after a crash is recognisably the same request.
     */
    requestId: z.string().regex(SELECTION_LIST_SEED_REQUEST_ID_PATTERN),
    organizationId: slOrganizationIdV1,
    /** 'user' is accepted by the schema but answered with seed.failed SCOPE_UNSUPPORTED until user-scoped lists exist. */
    scope: slSeedScopeV1,
    /** Required for scope 'user'; forbidden for scope 'org'. */
    userId: slUserIdV1.optional(),
    source: z
      .object({
        /** The requesting app's registry slug — the allowlist key and the default list-key namespace. */
        app: slSlugV1.refine((a) => a !== PLATFORM_SEED_SOURCE, {
          message: `"${PLATFORM_SEED_SOURCE}" is reserved for the service's own packs`,
        }),
        /** The producing service's name, for audit/observability. Authenticated via `attestation`, not trusted from here. */
        service: z.string().min(1).max(128),
      })
      .strict(),
    pack: z
      .object({
        /** Stable pack identifier within the source app. */
        key: slSlugV1,
        /** Monotonic content version. A version's content is immutable once applied. */
        version: z.number().int().positive(),
      })
      .strict(),
    trigger: slSeedTriggerV1,
    attestation: z
      .object({
        kind: z.literal('service-token'),
        token: z.string().min(1).max(SELECTION_LIST_LIMITS.MAX_ATTESTATION_TOKEN_LENGTH),
      })
      .strict(),
    lists: z.array(slSeedListSpecV1).min(1).max(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.lists.forEach((list, li) => {
      if (list.visibility === 'platform') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lists', li, 'visibility'],
          message: 'an app seed request cannot create a platform (common) list; use "org" or "private"',
        });
      }
    });
    if (p.scope === 'user' && p.userId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userId'], message: 'userId is required when scope is "user"' });
    }
    if (p.scope === 'org' && p.userId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userId'], message: 'userId must be omitted when scope is "org"' });
    }
    refineSeedLists(p.lists, ctx);
  });

export type SelectionListsSeedRequestedPayloadV1 = z.infer<typeof selectionListsSeedRequestedSchemaV1>;
