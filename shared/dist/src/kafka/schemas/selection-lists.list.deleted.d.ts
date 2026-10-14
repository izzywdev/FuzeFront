import { z } from 'zod';
/**
 * `selection-lists.list.deleted` — the list was PURGED (`DELETE ?purge=true`):
 * the list, its items, translations and access grants are gone and its item
 * ids no longer resolve. Thin payload; NO per-item/translation/access events
 * are emitted for the cascade — this event implies all of them.
 */
export declare const selectionListsListDeletedSchemaV1: any;
export type SelectionListsListDeletedPayloadV1 = z.infer<typeof selectionListsListDeletedSchemaV1>;
