import { z } from 'zod';
/** `selection-lists.item.created` — an item was added to a list (by a user or by seeding). */
export declare const selectionListsItemCreatedSchemaV1: z.ZodObject<{
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
    item: z.ZodObject<{
        itemId: z.ZodString;
        code: z.ZodString;
        label: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        sortOrder: z.ZodNumber;
        status: z.ZodEnum<["active", "archived"]>;
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
        status: "active" | "archived";
        code: string;
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
        itemId: string;
        label: string;
        sortOrder: number;
    }, {
        status: "active" | "archived";
        code: string;
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
        itemId: string;
        label: string;
        sortOrder: number;
    }>;
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
    item: {
        status: "active" | "archived";
        code: string;
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
        itemId: string;
        label: string;
        sortOrder: number;
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
    item: {
        status: "active" | "archived";
        code: string;
        description: string | null;
        seed: {
            source: string;
            packKey: string;
            packVersion: number;
            userModified: boolean;
        } | null;
        createdAt: string;
        updatedAt: string;
        itemId: string;
        label: string;
        sortOrder: number;
    };
}>;
export type SelectionListsItemCreatedPayloadV1 = z.infer<typeof selectionListsItemCreatedSchemaV1>;
