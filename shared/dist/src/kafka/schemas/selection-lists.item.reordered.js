"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsItemReorderedSchemaV1 = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.item.reordered` — `PUT /lists/{id}/items/reorder` replaced
 * the order. `order` is the COMPLETE resulting order of the list's items
 * (bounded by the per-list item quota), so a consumer replaces, never merges.
 */
exports.selectionListsItemReorderedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    order: zod_1.z
        .array(zod_1.z.object({
        itemId: selection_lists_common_1.slItemIdV1,
        code: selection_lists_common_1.slItemCodeV1,
        sortOrder: zod_1.z.number().int().nonnegative(),
    }))
        .min(1)
        .max(selection_lists_common_1.SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST),
});
