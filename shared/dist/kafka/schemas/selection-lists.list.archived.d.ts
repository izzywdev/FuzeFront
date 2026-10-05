import { z } from 'zod';
/**
 * `selection-lists.list.archived` — the list is hidden from pickers but its
 * items still RESOLVE (stored references stay valid). Emitted by
 * `POST /lists/{id}/archive` and `DELETE /lists/{id}` without `purge`.
 * Not emitted for an org-wide cascade from `identity.org.deleted` — consume
 * that topic directly for org teardown.
 */
export declare const selectionListsListArchivedSchemaV1: z.ZodEffects<z.ZodObject<{
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    }>;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
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
        visibility?: "platform" | "private" | "org" | undefined;
        forkedFrom?: {
            organizationId: string;
            listId: string;
            listRevision: number;
            forkedAt: string;
        } | null | undefined;
    };
}>;
export type SelectionListsListArchivedPayloadV1 = z.infer<typeof selectionListsListArchivedSchemaV1>;
