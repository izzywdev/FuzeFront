import { z } from 'zod';
/**
 * Which thing a translation belongs to. A polymorphic reference, so it carries
 * its discriminator (`kind`) — governance/identifier-standard.md §2.
 */
export declare const selectionListsTranslationTargetV1: any;
/**
 * `selection-lists.translation.upserted` — a NON-source-locale translation of a
 * list or an item was written (by a user, by autofill, or by seeding).
 * Source-locale text is part of the list/item snapshot and changes surface as
 * `list.updated` / `item.updated`, never here.
 */
export declare const selectionListsTranslationUpsertedSchemaV1: any;
export type SelectionListsTranslationUpsertedPayloadV1 = z.infer<typeof selectionListsTranslationUpsertedSchemaV1>;
