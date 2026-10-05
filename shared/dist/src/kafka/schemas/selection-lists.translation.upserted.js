"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsTranslationUpsertedSchemaV1 = exports.selectionListsTranslationTargetV1 = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * Which thing a translation belongs to. A polymorphic reference, so it carries
 * its discriminator (`kind`) — governance/identifier-standard.md §2.
 */
exports.selectionListsTranslationTargetV1 = zod_1.z.discriminatedUnion('kind', [
    zod_1.z.object({ kind: zod_1.z.literal('list'), name: selection_lists_common_1.slNameV1, description: selection_lists_common_1.slDescriptionV1.nullable() }),
    zod_1.z.object({
        kind: zod_1.z.literal('item'),
        itemId: selection_lists_common_1.slItemIdV1,
        itemCode: selection_lists_common_1.slItemCodeV1,
        label: selection_lists_common_1.slNameV1,
        description: selection_lists_common_1.slDescriptionV1.nullable(),
    }),
]);
/**
 * `selection-lists.translation.upserted` — a NON-source-locale translation of a
 * list or an item was written (by a user, by autofill, or by seeding).
 * Source-locale text is part of the list/item snapshot and changes surface as
 * `list.updated` / `item.updated`, never here.
 */
exports.selectionListsTranslationUpsertedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    locale: selection_lists_common_1.slLocaleV1,
    /** True when the text was machine-translated (autofill) and not yet human-reviewed. */
    isMachine: zod_1.z.boolean(),
    target: exports.selectionListsTranslationTargetV1,
});
