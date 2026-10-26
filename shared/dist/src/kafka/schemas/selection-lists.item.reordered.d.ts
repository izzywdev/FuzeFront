import { z } from 'zod';
/**
 * `selection-lists.item.reordered` — `PUT /lists/{id}/items/reorder` replaced
 * the order. `order` is the COMPLETE resulting order of the list's items
 * (bounded by the per-list item quota), so a consumer replaces, never merges.
 */
export declare const selectionListsItemReorderedSchemaV1: any;
export type SelectionListsItemReorderedPayloadV1 = z.infer<typeof selectionListsItemReorderedSchemaV1>;
