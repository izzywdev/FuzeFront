import { z } from 'zod';
/**
 * `selection-lists.list.archived` — the list is hidden from pickers but its
 * items still RESOLVE (stored references stay valid). Emitted by
 * `POST /lists/{id}/archive` and `DELETE /lists/{id}` without `purge`.
 * Not emitted for an org-wide cascade from `identity.org.deleted` — consume
 * that topic directly for org teardown.
 */
export declare const selectionListsListArchivedSchemaV1: any;
export type SelectionListsListArchivedPayloadV1 = z.infer<typeof selectionListsListArchivedSchemaV1>;
