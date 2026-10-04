import { z } from 'zod';
import { slItemCodeV1, slItemIdV1, slListEventBaseV1 } from './selection-lists.common';

/**
 * `selection-lists.item.deleted` — the item was PURGED and its id no longer
 * resolves. Its translations went with it (no translation.deleted events).
 */
export const selectionListsItemDeletedSchemaV1 = slListEventBaseV1.extend({
  itemId: slItemIdV1,
  code: slItemCodeV1,
});

export type SelectionListsItemDeletedPayloadV1 = z.infer<typeof selectionListsItemDeletedSchemaV1>;
