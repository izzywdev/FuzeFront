import { z } from 'zod';
import { slItemSnapshotV1, slListEventBaseV1 } from './selection-lists.common';

/** `selection-lists.item.created` — an item was added to a list (by a user or by seeding). */
export const selectionListsItemCreatedSchemaV1 = slListEventBaseV1.extend({
  item: slItemSnapshotV1,
});

export type SelectionListsItemCreatedPayloadV1 = z.infer<typeof selectionListsItemCreatedSchemaV1>;
