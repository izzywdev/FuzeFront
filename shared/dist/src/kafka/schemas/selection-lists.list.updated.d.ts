import { z } from 'zod';
export declare const SELECTION_LIST_UPDATABLE_FIELDS: readonly ["key", "sourceLocale", "status", "name", "description"];
/**
 * `selection-lists.list.updated` — list metadata changed. A RESTORE
 * (archived -> active) is an update with `status` in `changedFields`; an
 * archive has its own topic (`list.archived`). `key` is mutable over HTTP, so
 * a key change carries `previousKey` — a consumer that indexes by key must
 * re-key on it. `listKey` (top level) is the key AFTER the change.
 */
export declare const selectionListsListUpdatedSchemaV1: any;
export type SelectionListsListUpdatedPayloadV1 = z.infer<typeof selectionListsListUpdatedSchemaV1>;
