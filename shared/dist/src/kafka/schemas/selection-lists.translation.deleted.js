"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsTranslationDeletedSchemaV1 = void 0;
const zod_1 = require("zod");
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.translation.deleted` — a non-source-locale translation was
 * removed; readers fall back per the service's locale fallback rules.
 * `target` carries its discriminator, as in translation.upserted.
 */
exports.selectionListsTranslationDeletedSchemaV1 = selection_lists_common_1.slListEventBaseV1.extend({
    locale: selection_lists_common_1.slLocaleV1,
    target: zod_1.z.discriminatedUnion('kind', [
        zod_1.z.object({ kind: zod_1.z.literal('list') }),
        zod_1.z.object({ kind: zod_1.z.literal('item'), itemId: selection_lists_common_1.slItemIdV1, itemCode: selection_lists_common_1.slItemCodeV1 }),
    ]),
});
