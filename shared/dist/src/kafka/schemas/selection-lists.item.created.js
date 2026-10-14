"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsItemCreatedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/** `selection-lists.item.created` — an item was added to a list (by a user or by seeding). */
exports.selectionListsItemCreatedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    item: selection_lists_common_1.slItemSnapshotV1,
});
