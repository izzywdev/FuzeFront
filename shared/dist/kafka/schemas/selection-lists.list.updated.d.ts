import { z } from 'zod';
export declare const SELECTION_LIST_UPDATABLE_FIELDS: readonly ["key", "sourceLocale", "status", "name", "description"];
/**
 * `selection-lists.list.updated` — list metadata changed. A RESTORE
 * (archived -> active) is an update with `status` in `changedFields`; an
 * archive has its own topic (`list.archived`). `key` is mutable over HTTP, so
 * a key change carries `previousKey` — a consumer that indexes by key must
 * re-key on it. `listKey` (top level) is the key AFTER the change.
 */
export declare const selectionListsListUpdatedSchemaV1: z.ZodEffects<z.ZodObject<{
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
    list: z.ZodObject<{
        listId: z.ZodString;
        key: z.ZodString;
        sourceLocale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
        status: z.ZodEnum<["active", "archived"]>;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        seed: z.ZodNullable<z.ZodObject<{
            source: z.ZodString;
            packKey: z.ZodString;
            packVersion: z.ZodNumber;
            userModified: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        }, {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        }>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    }, {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    }>;
    changedFields: z.ZodArray<z.ZodEnum<["key", "sourceLocale", "status", "name", "description"]>, "many">;
    previousKey: z.ZodNullable<z.ZodString>;
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
    list: {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    };
    changedFields: ("name" | "status" | "key" | "sourceLocale" | "description")[];
    previousKey: string | null;
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
    list: {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    };
    changedFields: ("name" | "status" | "key" | "sourceLocale" | "description")[];
    previousKey: string | null;
}>, {
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
    list: {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    };
    changedFields: ("name" | "status" | "key" | "sourceLocale" | "description")[];
    previousKey: string | null;
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
    list: {
        name: string;
        status: "active" | "archived";
        listId: string;
        key: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
    };
    changedFields: ("name" | "status" | "key" | "sourceLocale" | "description")[];
    previousKey: string | null;
}>;
export type SelectionListsListUpdatedPayloadV1 = z.infer<typeof selectionListsListUpdatedSchemaV1>;
