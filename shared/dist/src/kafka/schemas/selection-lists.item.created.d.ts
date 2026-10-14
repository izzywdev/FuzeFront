import { z } from 'zod';
/** `selection-lists.item.created` — an item was added to a list (by a user or by seeding). */
export declare const selectionListsItemCreatedSchemaV1: any;
export type SelectionListsItemCreatedPayloadV1 = z.infer<typeof selectionListsItemCreatedSchemaV1>;
