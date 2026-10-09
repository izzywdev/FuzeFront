import { z } from 'zod';
/**
 * `selection-lists.translation.deleted` — a non-source-locale translation was
 * removed; readers fall back per the service's locale fallback rules.
 * `target` carries its discriminator, as in translation.upserted.
 */
export declare const selectionListsTranslationDeletedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    listId: z.ZodString;
    listRevision: z.ZodNumber;
    eventId: z.ZodString;
    actor: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"user">;
        userId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "user";
        userId: string;
    }, {
        type: "user";
        userId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"system">;
        principal: z.ZodLiteral<"selection-list-service">;
        seedSource: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "system";
        principal: "selection-list-service";
        seedSource: string | null;
    }, {
        type: "system";
        principal: "selection-list-service";
        seedSource: string | null;
    }>]>;
    listKey: z.ZodString;
    locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
    target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"list">;
    }, "strip", z.ZodTypeAny, {
        kind: "list";
    }, {
        kind: "list";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"item">;
        itemId: z.ZodString;
        itemCode: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        itemId: string;
        kind: "item";
        itemCode: string;
    }, {
        itemId: string;
        kind: "item";
        itemCode: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    listId: string;
    listRevision: number;
    eventId: string;
    actor: {
        type: "user";
        userId: string;
    } | {
        type: "system";
        principal: "selection-list-service";
        seedSource: string | null;
    };
    listKey: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    target: {
        kind: "list";
    } | {
        itemId: string;
        kind: "item";
        itemCode: string;
    };
}, {
    organizationId: string;
    listId: string;
    listRevision: number;
    eventId: string;
    actor: {
        type: "user";
        userId: string;
    } | {
        type: "system";
        principal: "selection-list-service";
        seedSource: string | null;
    };
    listKey: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    target: {
        kind: "list";
    } | {
        itemId: string;
        kind: "item";
        itemCode: string;
    };
}>;
export type SelectionListsTranslationDeletedPayloadV1 = z.infer<typeof selectionListsTranslationDeletedSchemaV1>;
