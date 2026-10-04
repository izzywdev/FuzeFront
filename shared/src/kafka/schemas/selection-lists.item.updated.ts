import { z } from 'zod';
import { slItemSnapshotV1, slListEventBaseV1 } from './selection-lists.common';

export const SELECTION_LIST_ITEM_UPDATABLE_FIELDS = ['label', 'description', 'sortOrder', 'status'] as const;

/**
 * `selection-lists.item.updated` — an item's source-locale text, position or
 * status changed. A restore (archived -> active) is an update with `status`.
 * `code` is immutable, so it never appears in `changedFields`. A whole-list
 * reorder is `item.reordered`, not N of these.
 */
export const selectionListsItemUpdatedSchemaV1 = slListEventBaseV1.extend({
  item: slItemSnapshotV1,
  changedFields: z.array(z.enum(SELECTION_LIST_ITEM_UPDATABLE_FIELDS)).min(1),
});

export type SelectionListsItemUpdatedPayloadV1 = z.infer<typeof selectionListsItemUpdatedSchemaV1>;
