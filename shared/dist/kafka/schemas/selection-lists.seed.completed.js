"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsSeedCompletedSchemaV1 = exports.SELECTION_LIST_SEED_LIST_ACTIONS = exports.SELECTION_LIST_SEED_OUTCOMES = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * How the pack related to what was already applied for (org, source, packKey):
 *   applied          first time this pack was applied to the org
 *   upgraded         a higher version was applied over a lower one
 *   already-applied  this exact version was already applied — no changes (duplicate / re-send)
 *   superseded       a HIGHER version is already applied — no changes (late / out-of-order request)
 */
exports.SELECTION_LIST_SEED_OUTCOMES = ['applied', 'upgraded', 'already-applied', 'superseded'];
/**
 * Per-list result. `skipped-user-edited` / `skipped-user-deleted` are the
 * "never overwrite the user" rule made visible: the list (or every item in it)
 * was changed or removed by a human after seeding, so seeding left it alone.
 */
exports.SELECTION_LIST_SEED_LIST_ACTIONS = [
    'created',
    'updated',
    'unchanged',
    'archived',
    'skipped-user-edited',
    'skipped-user-deleted',
];
/**
 * `selection-lists.seed.completed` — a seed request (or a platform default seed
 * triggered by `identity.org.created`) was processed successfully. The whole
 * request was applied atomically; there is no partial success.
 */
exports.selectionListsSeedCompletedSchemaV1 = selection_lists_common_1.slSeedOutcomeBaseV1.extend({
    outcome: zod_1.z.enum(exports.SELECTION_LIST_SEED_OUTCOMES),
    /** The highest version of this pack applied to the org after processing. */
    appliedVersion: zod_1.z.number().int().positive(),
    /** One entry per list the pack touched (current + lists dropped since the previous version). */
    lists: zod_1.z
        .array(zod_1.z.object({
        /** Null only for `skipped-user-deleted` (the list no longer exists). */
        listId: selection_lists_common_1.slListIdV1.nullable(),
        key: selection_lists_common_1.slListKeyV1,
        action: zod_1.z.enum(exports.SELECTION_LIST_SEED_LIST_ACTIONS),
        itemsCreated: zod_1.z.number().int().nonnegative(),
        itemsUpdated: zod_1.z.number().int().nonnegative(),
        itemsArchived: zod_1.z.number().int().nonnegative(),
        /** Items left alone because a human edited or deleted them after seeding. */
        itemsSkipped: zod_1.z.number().int().nonnegative(),
    }))
        .max(100),
});
