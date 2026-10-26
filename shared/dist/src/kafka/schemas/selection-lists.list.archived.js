"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsListArchivedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.list.archived` — the list is hidden from pickers but its
 * items still RESOLVE (stored references stay valid). Emitted by
 * `POST /lists/{id}/archive` and `DELETE /lists/{id}` without `purge`.
 * Not emitted for an org-wide cascade from `identity.org.deleted` — consume
 * that topic directly for org teardown.
 */
exports.selectionListsListArchivedSchemaV1 = selection_lists_common_1.slListEventBaseV1
    .extend({ list: selection_lists_common_1.slListSnapshotV1 })
    .refine((p) => p.list.status === 'archived', {
    path: ['list', 'status'],
    message: 'an archived event must carry status "archived"',
});
