import { z } from 'zod';
import { slListEventBaseV1, slListSnapshotV1 } from './selection-lists.common';

/**
 * `selection-lists.list.created` — a list now exists in an organization, either
 * created by a user over HTTP or by seeding (`list.seed` is then non-null and
 * `actor` is the system principal). Carries the full snapshot so a consumer
 * can build its read model without calling back.
 */
export const selectionListsListCreatedSchemaV1 = slListEventBaseV1.extend({
  list: slListSnapshotV1,
});

export type SelectionListsListCreatedPayloadV1 = z.infer<typeof selectionListsListCreatedSchemaV1>;
