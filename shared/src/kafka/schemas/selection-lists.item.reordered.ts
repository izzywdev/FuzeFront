import { z } from 'zod';
import { SELECTION_LIST_LIMITS, slItemCodeV1, slItemIdV1, slListEventBaseV1 } from './selection-lists.common';

/**
 * `selection-lists.item.reordered` — `PUT /lists/{id}/items/reorder` replaced
 * the order. `order` is the COMPLETE resulting order of the list's items
 * (bounded by the per-list item quota), so a consumer replaces, never merges.
 */
export const selectionListsItemReorderedSchemaV1 = slListEventBaseV1.extend({
  order: z
    .array(
      z.object({
        itemId: slItemIdV1,
        code: slItemCodeV1,
        sortOrder: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST),
});

export type SelectionListsItemReorderedPayloadV1 = z.infer<typeof selectionListsItemReorderedSchemaV1>;
