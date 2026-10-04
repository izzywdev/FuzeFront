import { z } from 'zod';
import { slListIdV1, slListKeyV1, slSeedOutcomeBaseV1 } from './selection-lists.common';

/**
 * How the pack related to what was already applied for (org, source, packKey):
 *   applied          first time this pack was applied to the org
 *   upgraded         a higher version was applied over a lower one
 *   already-applied  this exact version was already applied — no changes (duplicate / re-send)
 *   superseded       a HIGHER version is already applied — no changes (late / out-of-order request)
 */
export const SELECTION_LIST_SEED_OUTCOMES = ['applied', 'upgraded', 'already-applied', 'superseded'] as const;

/**
 * Per-list result. `skipped-user-edited` / `skipped-user-deleted` are the
 * "never overwrite the user" rule made visible: the list (or every item in it)
 * was changed or removed by a human after seeding, so seeding left it alone.
 */
export const SELECTION_LIST_SEED_LIST_ACTIONS = [
  'created',
  'updated',
  'unchanged',
  'archived',
  'skipped-user-edited',
  'skipped-user-deleted',
] as const;

/**
 * `selection-lists.seed.completed` — a seed request (or a platform default seed
 * triggered by `identity.org.created`) was processed successfully. The whole
 * request was applied atomically; there is no partial success.
 */
export const selectionListsSeedCompletedSchemaV1 = slSeedOutcomeBaseV1.extend({
  outcome: z.enum(SELECTION_LIST_SEED_OUTCOMES),
  /** The highest version of this pack applied to the org after processing. */
  appliedVersion: z.number().int().positive(),
  /** One entry per list the pack touched (current + lists dropped since the previous version). */
  lists: z
    .array(
      z.object({
        /** Null only for `skipped-user-deleted` (the list no longer exists). */
        listId: slListIdV1.nullable(),
        key: slListKeyV1,
        action: z.enum(SELECTION_LIST_SEED_LIST_ACTIONS),
        itemsCreated: z.number().int().nonnegative(),
        itemsUpdated: z.number().int().nonnegative(),
        itemsArchived: z.number().int().nonnegative(),
        /** Items left alone because a human edited or deleted them after seeding. */
        itemsSkipped: z.number().int().nonnegative(),
      }),
    )
    .max(100),
});

export type SelectionListsSeedCompletedPayloadV1 = z.infer<typeof selectionListsSeedCompletedSchemaV1>;
