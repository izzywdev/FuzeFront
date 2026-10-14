"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectionListsListDeletedSchemaV1 = void 0;
const selection_lists_common_1 = require("./selection-lists.common");
/**
 * `selection-lists.list.deleted` — the list was PURGED (`DELETE ?purge=true`):
 * the list, its items, translations and access grants are gone and its item
 * ids no longer resolve. Thin payload; NO per-item/translation/access events
 * are emitted for the cascade — this event implies all of them.
 */
exports.selectionListsListDeletedSchemaV1 = selection_lists_common_1.slListEventBaseV1;
