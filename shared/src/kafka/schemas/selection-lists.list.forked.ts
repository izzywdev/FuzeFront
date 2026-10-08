import { z } from 'zod';
import {
  SELECTION_LIST_MAX_FORK_ITEMS,
  slItemIdV1,
  slListEventBaseV1,
  slListIdV1,
  slListKeyV1,
  slListRevisionV1,
  slListSnapshotV1,
  slOrganizationIdV1,
} from './selection-lists.common';

/**
 * `selection-lists.list.forked` (shared 1.3.0, HTTP contract 4.1.0) — an
 * organization copied a common (`platform`) list into itself with
 * `POST /v1/selection-lists/{listId}/fork` (copy-on-write). Design:
 * docs/planning/selection-lists-shared-and-fork.md.
 *
 * Emitted in the SAME transaction as the `list.created` / `item.created` /
 * `translation.upserted` events for the copied content (so a consumer that does
 * not know about forks still builds a correct read model) and the owner's
 * `access.granted`. This event adds what those cannot carry: the provenance and
 * the complete source→fork item id map, which is what a consumer needs to
 * migrate values it stored against the common list's item ids.
 *
 * Partitioned like every selection-lists event: `organizationId` is the
 * FORKING organization (the fork's owner), `listId`/`listKey`/`listRevision`
 * describe the fork. The source's organization is `source.organizationId`
 * (the platform organization for a common list).
 */
export const selectionListsListForkedSchemaV1 = slListEventBaseV1
  .extend({
    /** The fork as created (visibility `org` or `private`, `forkedFrom` set). */
    list: slListSnapshotV1,
    source: z.object({
      listId: slListIdV1,
      organizationId: slOrganizationIdV1,
      listKey: slListKeyV1,
      /** The source's revision at the moment of copying. */
      listRevision: slListRevisionV1,
    }),
    /**
     * Every copied item: `originItemId` (the common list's item) → `itemId`
     * (the fork's new, service-minted item). Includes archived items, which are
     * copied with their status so stored references keep resolving.
     */
    itemMap: z
      .array(z.object({ originItemId: slItemIdV1, itemId: slItemIdV1 }))
      .max(SELECTION_LIST_MAX_FORK_ITEMS),
  })
  .superRefine((p, ctx) => {
    if (p.source.organizationId === p.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'organizationId'],
        message: 'a fork copies a list of ANOTHER organization; source and fork organizations must differ',
      });
    }
    if (p.source.listKey !== p.listKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['listKey'], message: 'a fork keeps the source list key' });
    }
    if (p.list.visibility === 'platform') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['list', 'visibility'], message: 'a fork is never a platform list' });
    }
    const origins = new Set<string>();
    const forks = new Set<string>();
    p.itemMap.forEach((m, i) => {
      if (origins.has(m.originItemId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemMap', i, 'originItemId'], message: 'duplicate originItemId' });
      }
      if (forks.has(m.itemId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemMap', i, 'itemId'], message: 'duplicate itemId' });
      }
      origins.add(m.originItemId);
      forks.add(m.itemId);
    });
  });

export type SelectionListsListForkedPayloadV1 = z.infer<typeof selectionListsListForkedSchemaV1>;
