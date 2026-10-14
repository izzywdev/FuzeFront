"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsItemDeletedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.item.deleted` — the item was PURGED and its id no longer
 * resolves. Its translations went with it (no translation.deleted events).
 */
exports.selectionListsItemDeletedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    itemId: selection_lists_common_1.slItemIdV1,
    code: selection_lists_common_1.slItemCodeV1,
});
