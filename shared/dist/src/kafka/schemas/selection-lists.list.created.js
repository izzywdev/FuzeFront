"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsListCreatedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.list.created` — a list now exists in an organization, either
 * created by a user over HTTP or by seeding (`list.seed` is then non-null and
 * `actor` is the system principal). Carries the full snapshot so a consumer
 * can build its read model without calling back.
 */
exports.selectionListsListCreatedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    list: selection_lists_common_1.slListSnapshotV1,
});
