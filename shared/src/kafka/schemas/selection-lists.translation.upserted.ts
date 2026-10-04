import { z } from 'zod';
import {
  slDescriptionV1,
  slItemCodeV1,
  slItemIdV1,
  slListEventBaseV1,
  slLocaleV1,
  slNameV1,
} from './selection-lists.common';

/**
 * Which thing a translation belongs to. A polymorphic reference, so it carries
 * its discriminator (`kind`) — governance/identifier-standard.md §2.
 */
export const selectionListsTranslationTargetV1 = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list'), name: slNameV1, description: slDescriptionV1.nullable() }),
  z.object({
    kind: z.literal('item'),
    itemId: slItemIdV1,
    itemCode: slItemCodeV1,
    label: slNameV1,
    description: slDescriptionV1.nullable(),
  }),
]);

/**
 * `selection-lists.translation.upserted` — a NON-source-locale translation of a
 * list or an item was written (by a user, by autofill, or by seeding).
 * Source-locale text is part of the list/item snapshot and changes surface as
 * `list.updated` / `item.updated`, never here.
 */
export const selectionListsTranslationUpsertedSchemaV1 = slListEventBaseV1.extend({
  locale: slLocaleV1,
  /** True when the text was machine-translated (autofill) and not yet human-reviewed. */
  isMachine: z.boolean(),
  target: selectionListsTranslationTargetV1,
});

export type SelectionListsTranslationUpsertedPayloadV1 = z.infer<typeof selectionListsTranslationUpsertedSchemaV1>;
