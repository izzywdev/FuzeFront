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
        visibility: z.ZodOptional<z.ZodEnum<["private", "org", "platform"]>>;
        forkedFrom: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            listId: z.ZodString;
            organizationId: z.ZodString;
            listRevision: z.ZodNumber;
            forkedAt: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        }, {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        }>>>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    }, {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    }>;
    changedFields: z.ZodArray<z.ZodEnum<["key", "sourceLocale", "status", "name", "description"]>, "many">;
    previousKey: z.ZodNullable<z.ZodString>;
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
    list: {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
    changedFields: ("key" | "name" | "status" | "sourceLocale" | "description")[];
    previousKey: string | null;
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
    list: {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
    changedFields: ("key" | "name" | "status" | "sourceLocale" | "description")[];
    previousKey: string | null;
}>, {
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
    list: {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
    changedFields: ("key" | "name" | "status" | "sourceLocale" | "description")[];
    previousKey: string | null;
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
    list: {
        key: string;
        name: string;
        status: "active" | "archived";
        listId: string;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
    changedFields: ("key" | "name" | "status" | "sourceLocale" | "description")[];
    previousKey: string | null;
}>;
export type SelectionListsListUpdatedPayloadV1 = z.infer<typeof selectionListsListUpdatedSchemaV1>;
