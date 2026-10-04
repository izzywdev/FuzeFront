"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsItemArchivedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/** `selection-lists.item.archived` — hidden from pickers; still resolves for stored references. */
exports.selectionListsItemArchivedSchemaV1 = selection_lists_common_1.slListEventBaseV1
    .extend({ item: selection_lists_common_1.slItemSnapshotV1 })
    .refine((p) => p.item.status === 'archived', {
    path: ['item', 'status'],
    message: 'an archived event must carry status "archived"',
});
