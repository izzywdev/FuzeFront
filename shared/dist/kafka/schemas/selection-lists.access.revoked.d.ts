import { z } from 'zod';
/** `selection-lists.access.revoked` — the user no longer holds any role on the list. */
export declare const selectionListsAccessRevokedSchemaV1: z.ZodObject<{
    eventId: z.ZodString;
    organizationId: z.ZodString;
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
    listId: z.ZodString;
    listKey: z.ZodString;
    /** The user whose grant was removed. */
    userId: z.ZodString;
    /** The role that was revoked. */
    role: z.ZodEnum<["list-owner", "list-editor", "list-contributor", "list-translator", "list-viewer"]>;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    userId: string;
    role: "list-owner" | "list-editor" | "list-contributor" | "list-translator" | "list-viewer";
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
}, {
    organizationId: string;
    userId: string;
    role: "list-owner" | "list-editor" | "list-contributor" | "list-translator" | "list-viewer";
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
}>;
export type SelectionListsAccessRevokedPayloadV1 = z.infer<typeof selectionListsAccessRevokedSchemaV1>;
