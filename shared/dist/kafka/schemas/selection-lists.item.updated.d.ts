import { z } from 'zod';
export declare const SELECTION_LIST_ITEM_UPDATABLE_FIELDS: readonly ["label", "description", "sortOrder", "status"];
/**
 * `selection-lists.item.updated` — an item's source-locale text, position or
 * status changed. A restore (archived -> active) is an update with `status`.
 * `code` is immutable, so it never appears in `changedFields`. A whole-list
 * reorder is `item.reordered`, not N of these.
 */
export declare const selectionListsItemUpdatedSchemaV1: z.ZodObject<{
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
        originItemId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
        originItemId?: string | null | undefined;
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
        originItemId?: string | null | undefined;
    }>;
    changedFields: z.ZodArray<z.ZodEnum<["label", "description", "sortOrder", "status"]>, "many">;
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
    changedFields: ("status" | "description" | "label" | "sortOrder")[];
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
        originItemId?: string | null | undefined;
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
    changedFields: ("status" | "description" | "label" | "sortOrder")[];
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
        originItemId?: string | null | undefined;
    };
}>;
export type SelectionListsItemUpdatedPayloadV1 = z.infer<typeof selectionListsItemUpdatedSchemaV1>;
