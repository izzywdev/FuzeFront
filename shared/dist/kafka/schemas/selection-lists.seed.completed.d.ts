import { z } from 'zod';
/**
 * How the pack related to what was already applied for (org, source, packKey):
 *   applied          first time this pack was applied to the org
 *   upgraded         a higher version was applied over a lower one
 *   already-applied  this exact version was already applied — no changes (duplicate / re-send)
 *   superseded       a HIGHER version is already applied — no changes (late / out-of-order request)
 */
export declare const SELECTION_LIST_SEED_OUTCOMES: readonly ["applied", "upgraded", "already-applied", "superseded"];
/**
 * Per-list result. `skipped-user-edited` / `skipped-user-deleted` are the
 * "never overwrite the user" rule made visible: the list (or every item in it)
 * was changed or removed by a human after seeding, so seeding left it alone.
 */
export declare const SELECTION_LIST_SEED_LIST_ACTIONS: readonly ["created", "updated", "unchanged", "archived", "skipped-user-edited", "skipped-user-deleted"];
/**
 * `selection-lists.seed.completed` — a seed request (or a platform default seed
 * triggered by `identity.org.created`) was processed successfully. The whole
 * request was applied atomically; there is no partial success.
 */
export declare const selectionListsSeedCompletedSchemaV1: z.ZodObject<{
    organizationId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    source: z.ZodObject<{
        app: z.ZodString;
        service: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        app: string;
        service: string;
    }, {
        app: string;
        service: string;
    }>;
    eventId: z.ZodString;
    requestId: z.ZodNullable<z.ZodString>;
    scope: z.ZodEnum<["org", "user"]>;
    pack: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        key: string;
        version: number;
    }, {
        key: string;
        version: number;
    }>;
    trigger: z.ZodEnum<["org-created", "app-installed", "app-upgraded", "backfill", "manual"]>;
    outcome: z.ZodEnum<["applied", "upgraded", "already-applied", "superseded"]>;
    appliedVersion: z.ZodNumber;
    lists: z.ZodArray<z.ZodObject<{
        /** Null only for `skipped-user-deleted` (the list no longer exists). */
        listId: z.ZodNullable<z.ZodString>;
        key: z.ZodString;
        action: z.ZodEnum<["created", "updated", "unchanged", "archived", "skipped-user-edited", "skipped-user-deleted"]>;
        itemsCreated: z.ZodNumber;
        itemsUpdated: z.ZodNumber;
        itemsArchived: z.ZodNumber;
        /** Items left alone because a human edited or deleted them after seeding. */
        itemsSkipped: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        listId: string | null;
        key: string;
        action: "archived" | "created" | "updated" | "unchanged" | "skipped-user-edited" | "skipped-user-deleted";
        itemsCreated: number;
        itemsUpdated: number;
        itemsArchived: number;
        itemsSkipped: number;
    }, {
        listId: string | null;
        key: string;
        action: "archived" | "created" | "updated" | "unchanged" | "skipped-user-edited" | "skipped-user-deleted";
        itemsCreated: number;
        itemsUpdated: number;
        itemsArchived: number;
        itemsSkipped: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    eventId: string;
    lists: {
        listId: string | null;
        key: string;
        action: "archived" | "created" | "updated" | "unchanged" | "skipped-user-edited" | "skipped-user-deleted";
        itemsCreated: number;
        itemsUpdated: number;
        itemsArchived: number;
        itemsSkipped: number;
    }[];
    requestId: string | null;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    outcome: "applied" | "upgraded" | "already-applied" | "superseded";
    appliedVersion: number;
    userId?: string | undefined;
}, {
    organizationId: string;
    source: {
        app: string;
        service: string;
    };
    eventId: string;
    lists: {
        listId: string | null;
        key: string;
        action: "archived" | "created" | "updated" | "unchanged" | "skipped-user-edited" | "skipped-user-deleted";
        itemsCreated: number;
        itemsUpdated: number;
        itemsArchived: number;
        itemsSkipped: number;
    }[];
    requestId: string | null;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    outcome: "applied" | "upgraded" | "already-applied" | "superseded";
    appliedVersion: number;
    userId?: string | undefined;
}>;
export type SelectionListsSeedCompletedPayloadV1 = z.infer<typeof selectionListsSeedCompletedSchemaV1>;
