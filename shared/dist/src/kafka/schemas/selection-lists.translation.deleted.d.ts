import { z } from 'zod';
/**
 * `selection-lists.translation.deleted` — a non-source-locale translation was
 * removed; readers fall back per the service's locale fallback rules.
 * `target` carries its discriminator, as in translation.upserted.
 */
export declare const selectionListsTranslationDeletedSchemaV1: any;
export type SelectionListsTranslationDeletedPayloadV1 = z.infer<typeof selectionListsTranslationDeletedSchemaV1>;
