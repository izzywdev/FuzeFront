import { z } from 'zod';
/**
 * `selection-lists.list.deleted` — the list was PURGED (`DELETE ?purge=true`):
 * the list, its items, translations and access grants are gone and its item
 * ids no longer resolve. Thin payload; NO per-item/translation/access events
 * are emitted for the cascade — this event implies all of them.
 */
export declare const selectionListsListDeletedSchemaV1: z.ZodObject<{
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
    listRevision: z.ZodNumber;
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
}>;
export type SelectionListsListDeletedPayloadV1 = z.infer<typeof selectionListsListDeletedSchemaV1>;
