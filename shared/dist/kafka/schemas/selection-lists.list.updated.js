"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsListUpdatedSchemaV1 = exports.SELECTION_LIST_UPDATABLE_FIELDS = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
exports.SELECTION_LIST_UPDATABLE_FIELDS = ['key', 'sourceLocale', 'status', 'name', 'description'];
/**
 * `selection-lists.list.updated` — list metadata changed. A RESTORE
 * (archived -> active) is an update with `status` in `changedFields`; an
 * archive has its own topic (`list.archived`). `key` is mutable over HTTP, so
 * a key change carries `previousKey` — a consumer that indexes by key must
 * re-key on it. `listKey` (top level) is the key AFTER the change.
 */
exports.selectionListsListUpdatedSchemaV1 = selection_lists_common_1.slListEventBaseV1
    .extend({
    list: selection_lists_common_1.slListSnapshotV1,
    changedFields: zod_1.z.array(zod_1.z.enum(exports.SELECTION_LIST_UPDATABLE_FIELDS)).min(1),
    previousKey: selection_lists_common_1.slListKeyV1.nullable(),
})
    .superRefine((p, ctx) => {
    const keyChanged = p.changedFields.includes('key');
    if (keyChanged !== (p.previousKey !== null)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['previousKey'],
            message: 'previousKey must be set if and only if changedFields includes "key"',
        });
    }
});
