import { z } from 'zod';
/**
 * `selection-lists.list.forked` (shared 1.3.0, HTTP contract 4.1.0) — an
 * organization copied a common (`platform`) list into itself with
 * `POST /v1/selection-lists/{listId}/fork` (copy-on-write). Design:
 * docs/planning/selection-lists-shared-and-fork.md.
 *
 * Emitted in the SAME transaction as the `list.created` / `item.created` /
 * `translation.upserted` events for the copied content (so a consumer that does
 * not know about forks still builds a correct read model) and the owner's
 * `access.granted`. This event adds what those cannot carry: the provenance and
 * the complete source→fork item id map, which is what a consumer needs to
 * migrate values it stored against the common list's item ids.
 *
 * Partitioned like every selection-lists event: `organizationId` is the
 * FORKING organization (the fork's owner), `listId`/`listKey`/`listRevision`
 * describe the fork. The source's organization is `source.organizationId`
 * (the platform organization for a common list).
 */
export declare const selectionListsListForkedSchemaV1: z.ZodEffects<z.ZodObject<{
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
    source: z.ZodObject<{
        listId: z.ZodString;
        organizationId: z.ZodString;
        listKey: z.ZodString;
        /** The source's revision at the moment of copying. */
        listRevision: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    }, {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    }>;
    itemMap: z.ZodArray<z.ZodObject<{
        originItemId: z.ZodString;
        itemId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        itemId: string;
        originItemId: string;
    }, {
        itemId: string;
        originItemId: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    source: {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    };
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
    itemMap: {
        itemId: string;
        originItemId: string;
    }[];
}, {
    organizationId: string;
    source: {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    };
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
    itemMap: {
        itemId: string;
        originItemId: string;
    }[];
}>, {
    organizationId: string;
    source: {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    };
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
    itemMap: {
        itemId: string;
        originItemId: string;
    }[];
}, {
    organizationId: string;
    source: {
        organizationId: string;
        listId: string;
        listRevision: number;
        listKey: string;
    };
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
    itemMap: {
        itemId: string;
        originItemId: string;
    }[];
}>;
export type SelectionListsListForkedPayloadV1 = z.infer<typeof selectionListsListForkedSchemaV1>;
