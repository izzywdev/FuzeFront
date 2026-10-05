import { z } from 'zod';
export declare const SELECTION_LIST_ITEM_UPDATABLE_FIELDS: readonly ["label", "description", "sortOrder", "status"];
/**
 * `selection-lists.item.updated` — an item's source-locale text, position or
 * status changed. A restore (archived -> active) is an update with `status`.
 * `code` is immutable, so it never appears in `changedFields`. A whole-list
 * reorder is `item.reordered`, not N of these.
 */
export declare const selectionListsItemUpdatedSchemaV1: any;
export type SelectionListsItemUpdatedPayloadV1 = z.infer<typeof selectionListsItemUpdatedSchemaV1>;
