import { z } from 'zod';
/**
 * Which thing a translation belongs to. A polymorphic reference, so it carries
 * its discriminator (`kind`) — governance/identifier-standard.md §2.
 */
export declare const selectionListsTranslationTargetV1: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"list">;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string | null;
    kind: "list";
}, {
    name: string;
    description: string | null;
    kind: "list";
}>, z.ZodObject<{
    kind: z.ZodLiteral<"item">;
    itemId: z.ZodString;
    itemCode: z.ZodString;
    label: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    description: string | null;
    itemId: string;
    label: string;
    kind: "item";
    itemCode: string;
}, {
    description: string | null;
    itemId: string;
    label: string;
    kind: "item";
    itemCode: string;
}>]>;
/**
 * `selection-lists.translation.upserted` — a NON-source-locale translation of a
 * list or an item was written (by a user, by autofill, or by seeding).
 * Source-locale text is part of the list/item snapshot and changes surface as
 * `list.updated` / `item.updated`, never here.
 */
export declare const selectionListsTranslationUpsertedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    listId: z.ZodString;
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
    listRevision: z.ZodNumber;
    locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
    isMachine: z.ZodBoolean;
    target: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"list">;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string | null;
        kind: "list";
    }, {
        name: string;
        description: string | null;
        kind: "list";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"item">;
        itemId: z.ZodString;
        itemCode: z.ZodString;
        label: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        description: string | null;
        itemId: string;
        label: string;
        kind: "item";
        itemCode: string;
    }, {
        description: string | null;
        itemId: string;
        label: string;
        kind: "item";
        itemCode: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    listId: string;
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
    listRevision: number;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    isMachine: boolean;
    target: {
        name: string;
        description: string | null;
        kind: "list";
    } | {
        description: string | null;
        itemId: string;
        label: string;
        kind: "item";
        itemCode: string;
    };
}, {
    organizationId: string;
    listId: string;
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
    listRevision: number;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    isMachine: boolean;
    target: {
        name: string;
        description: string | null;
        kind: "list";
    } | {
        description: string | null;
        itemId: string;
        label: string;
        kind: "item";
        itemCode: string;
    };
}>;
export type SelectionListsTranslationUpsertedPayloadV1 = z.infer<typeof selectionListsTranslationUpsertedSchemaV1>;
