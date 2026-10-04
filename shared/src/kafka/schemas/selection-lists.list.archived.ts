import { z } from 'zod';
import { slListEventBaseV1, slListSnapshotV1 } from './selection-lists.common';

/**
 * `selection-lists.list.archived` — the list is hidden from pickers but its
 * items still RESOLVE (stored references stay valid). Emitted by
 * `POST /lists/{id}/archive` and `DELETE /lists/{id}` without `purge`.
 * Not emitted for an org-wide cascade from `identity.org.deleted` — consume
 * that topic directly for org teardown.
 */
export const selectionListsListArchivedSchemaV1 = slListEventBaseV1
  .extend({ list: slListSnapshotV1 })
  .refine((p) => p.list.status === 'archived', {
    path: ['list', 'status'],
    message: 'an archived event must carry status "archived"',
  });

export type SelectionListsListArchivedPayloadV1 = z.infer<typeof selectionListsListArchivedSchemaV1>;
