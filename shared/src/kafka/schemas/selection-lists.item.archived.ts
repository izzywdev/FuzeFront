import { z } from 'zod';
import { slItemSnapshotV1, slListEventBaseV1 } from './selection-lists.common';

/** `selection-lists.item.archived` — hidden from pickers; still resolves for stored references. */
export const selectionListsItemArchivedSchemaV1 = slListEventBaseV1
  .extend({ item: slItemSnapshotV1 })
  .refine((p) => p.item.status === 'archived', {
    path: ['item', 'status'],
    message: 'an archived event must carry status "archived"',
  });

export type SelectionListsItemArchivedPayloadV1 = z.infer<typeof selectionListsItemArchivedSchemaV1>;
