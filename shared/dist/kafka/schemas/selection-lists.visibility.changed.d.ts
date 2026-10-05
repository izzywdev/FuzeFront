import { z } from 'zod';
/**
 * `selection-lists.visibility.changed` (shared 1.3.0, HTTP contract 4.1.0) — a
 * list's `visibility` changed through `PATCH /v1/selection-lists/{listId}`:
 * `private` ↔ `org` by the list owner, or `private`/`org` → `platform` by a
 * platform operator. Design: docs/planning/selection-lists-shared-and-fork.md.
 *
 * Its own topic rather than a `list.updated` `changedFields` value, so a
 * consumer that strictly enumerates `changedFields` is not broken by a value it
 * has never seen, and so the access-relevant change is easy to subscribe to
 * alone (a read model of "who can pick from this list" needs only this topic,
 * `list.created` and `list.deleted`).
 *
 * `platform` is one-way: `previousVisibility` is never `platform`. When a
 * single PATCH changes visibility AND other fields, the service emits
 * `list.updated` for the other fields and this event for the visibility, both
 * in the same transaction, each with its own `listRevision`.
 */
export declare const selectionListsVisibilityChangedSchemaV1: z.ZodEffects<z.ZodObject<{
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
    previousVisibility: z.ZodEnum<["private", "org", "platform"]>;
    visibility: z.ZodEnum<["private", "org", "platform"]>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    listId: string;
    listRevision: number;
    visibility: "platform" | "private" | "org";
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
    previousVisibility: "platform" | "private" | "org";
}, {
    organizationId: string;
    listId: string;
    listRevision: number;
    visibility: "platform" | "private" | "org";
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
    previousVisibility: "platform" | "private" | "org";
}>, {
    organizationId: string;
    listId: string;
    listRevision: number;
    visibility: "platform" | "private" | "org";
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
    previousVisibility: "platform" | "private" | "org";
}, {
    organizationId: string;
    listId: string;
    listRevision: number;
    visibility: "platform" | "private" | "org";
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
    previousVisibility: "platform" | "private" | "org";
}>;
export type SelectionListsVisibilityChangedPayloadV1 = z.infer<typeof selectionListsVisibilityChangedSchemaV1>;
