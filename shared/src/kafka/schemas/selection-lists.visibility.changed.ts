import { z } from 'zod';
import { slListEventBaseV1, slListSnapshotV1, slVisibilityV1 } from './selection-lists.common';

/**
 * `selection-lists.visibility.changed` (shared 1.3.0, HTTP contract 4.1.0) — a
 * list's `visibility` changed through `PATCH /v1/selection-lists/{listId}`:
 * `private` ↔ `org` by the list owner, or `private`/`org` → `platform` by a
 * platform operator. Design: docs/planning/selection-lists-shared-and-fork.md.
 *
 * Its own topic rather than a `list.updated` `changedFields` value, so a
 * consumer that strictly enumerates `changedFields` is not broken by a value it
 * has never seen, and so the access-relevant change is easy to subscribe to
 * alone (a read model of "who can pick from this list" needs only this topic,
 * `list.created` and `list.deleted`).
 *
 * `platform` is one-way: `previousVisibility` is never `platform`. When a
 * single PATCH changes visibility AND other fields, the service emits
 * `list.updated` for the other fields and this event for the visibility, both
 * in the same transaction, each with its own `listRevision`.
 */
export const selectionListsVisibilityChangedSchemaV1 = slListEventBaseV1
  .extend({
    /** The list after the change; `list.visibility` equals `visibility`. */
    list: slListSnapshotV1,
    previousVisibility: slVisibilityV1,
    visibility: slVisibilityV1,
  })
  .superRefine((p, ctx) => {
    if (p.previousVisibility === p.visibility) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['visibility'], message: 'visibility did not change' });
    }
    if (p.previousVisibility === 'platform') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previousVisibility'],
        message: 'a platform (common) list is never demoted',
      });
    }
    if (p.list.visibility !== undefined && p.list.visibility !== p.visibility) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['list', 'visibility'], message: 'list.visibility must equal visibility' });
    }
  });

export type SelectionListsVisibilityChangedPayloadV1 = z.infer<typeof selectionListsVisibilityChangedSchemaV1>;
