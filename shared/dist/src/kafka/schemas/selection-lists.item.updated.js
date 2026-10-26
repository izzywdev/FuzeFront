"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsItemUpdatedSchemaV1 = exports.SELECTION_LIST_ITEM_UPDATABLE_FIELDS = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
exports.SELECTION_LIST_ITEM_UPDATABLE_FIELDS = ['label', 'description', 'sortOrder', 'status'];
/**
 * `selection-lists.item.updated` — an item's source-locale text, position or
 * status changed. A restore (archived -> active) is an update with `status`.
 * `code` is immutable, so it never appears in `changedFields`. A whole-list
 * reorder is `item.reordered`, not N of these.
 */
exports.selectionListsItemUpdatedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    item: selection_lists_common_1.slItemSnapshotV1,
    changedFields: zod_1.z.array(zod_1.z.enum(exports.SELECTION_LIST_ITEM_UPDATABLE_FIELDS)).min(1),
});
