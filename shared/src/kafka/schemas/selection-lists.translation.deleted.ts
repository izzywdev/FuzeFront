import { z } from 'zod';
import { slItemCodeV1, slItemIdV1, slListEventBaseV1, slLocaleV1 } from './selection-lists.common';

/**
 * `selection-lists.translation.deleted` — a non-source-locale translation was
 * removed; readers fall back per the service's locale fallback rules.
 * `target` carries its discriminator, as in translation.upserted.
 */
export const selectionListsTranslationDeletedSchemaV1 = slListEventBaseV1.extend({
  locale: slLocaleV1,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('list') }),
    z.object({ kind: z.literal('item'), itemId: slItemIdV1, itemCode: slItemCodeV1 }),
  ]),
});

export type SelectionListsTranslationDeletedPayloadV1 = z.infer<typeof selectionListsTranslationDeletedSchemaV1>;
