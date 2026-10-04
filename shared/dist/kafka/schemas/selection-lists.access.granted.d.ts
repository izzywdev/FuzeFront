import { z } from 'zod';
/**
 * `selection-lists.access.granted` — a user now holds `role` on one list
 * instance (written to the Security API first, then mirrored). A role CHANGE
 * is a grant with `previousRole` set. Informational only: authorization stays
 * with the Security API / Permit — never authorize from this event.
 */
export declare const selectionListsAccessGrantedSchemaV1: z.ZodObject<{
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
    /** The grantee. */
    userId: z.ZodString;
    role: z.ZodEnum<["list-owner", "list-editor", "list-contributor", "list-translator", "list-viewer"]>;
    previousRole: z.ZodNullable<z.ZodEnum<["list-owner", "list-editor", "list-contributor", "list-translator", "list-viewer"]>>;
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
    previousRole: "list-owner" | "list-editor" | "list-contributor" | "list-translator" | "list-viewer" | null;
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
    previousRole: "list-owner" | "list-editor" | "list-contributor" | "list-translator" | "list-viewer" | null;
}>;
export type SelectionListsAccessGrantedPayloadV1 = z.infer<typeof selectionListsAccessGrantedSchemaV1>;
