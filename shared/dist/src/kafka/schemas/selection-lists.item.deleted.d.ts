import { z } from 'zod';
/**
 * `selection-lists.item.deleted` — the item was PURGED and its id no longer
 * resolves. Its translations went with it (no translation.deleted events).
 */
export declare const selectionListsItemDeletedSchemaV1: any;
export type SelectionListsItemDeletedPayloadV1 = z.infer<typeof selectionListsItemDeletedSchemaV1>;
