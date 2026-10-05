import { z } from 'zod';
/**
 * `selection-lists.list.created` — a list now exists in an organization, either
 * created by a user over HTTP or by seeding (`list.seed` is then non-null and
 * `actor` is the system principal). Carries the full snapshot so a consumer
 * can build its read model without calling back.
 */
export declare const selectionListsListCreatedSchemaV1: z.ZodObject<{
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
}>;
export type SelectionListsListCreatedPayloadV1 = z.infer<typeof selectionListsListCreatedSchemaV1>;
