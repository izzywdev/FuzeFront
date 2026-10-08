import { z } from 'zod';
import { slListEventBaseV1, slListKeyV1, slListSnapshotV1 } from './selection-lists.common';

export const SELECTION_LIST_UPDATABLE_FIELDS = ['key', 'sourceLocale', 'status', 'name', 'description'] as const;

/**
 * `selection-lists.list.updated` — list metadata changed. A RESTORE
 * (archived -> active) is an update with `status` in `changedFields`; an
 * archive has its own topic (`list.archived`). `key` is mutable over HTTP, so
 * a key change carries `previousKey` — a consumer that indexes by key must
 * re-key on it. `listKey` (top level) is the key AFTER the change.
 */
export const selectionListsListUpdatedSchemaV1 = slListEventBaseV1
  .extend({
    list: slListSnapshotV1,
    changedFields: z.array(z.enum(SELECTION_LIST_UPDATABLE_FIELDS)).min(1),
    previousKey: slListKeyV1.nullable(),
  })
  .superRefine((p, ctx) => {
    const keyChanged = p.changedFields.includes('key');
    if (keyChanged !== (p.previousKey !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousKey'],
        message: 'previousKey must be set if and only if changedFields includes "key"',
      });
    }
  });

export type SelectionListsListUpdatedPayloadV1 = z.infer<typeof selectionListsListUpdatedSchemaV1>;
