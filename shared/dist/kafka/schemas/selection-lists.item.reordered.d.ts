import { z } from 'zod';
/**
 * `selection-lists.item.reordered` — `PUT /lists/{id}/items/reorder` replaced
 * the order. `order` is the COMPLETE resulting order of the list's items
 * (bounded by the per-list item quota), so a consumer replaces, never merges.
 */
export declare const selectionListsItemReorderedSchemaV1: z.ZodObject<{
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
    order: z.ZodArray<z.ZodObject<{
        itemId: z.ZodString;
        code: z.ZodString;
        sortOrder: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        code: string;
        itemId: string;
        sortOrder: number;
    }, {
        code: string;
        itemId: string;
        sortOrder: number;
    }>, "many">;
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
    order: {
        code: string;
        itemId: string;
        sortOrder: number;
    }[];
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
    order: {
        code: string;
        itemId: string;
        sortOrder: number;
    }[];
}>;
export type SelectionListsItemReorderedPayloadV1 = z.infer<typeof selectionListsItemReorderedSchemaV1>;
