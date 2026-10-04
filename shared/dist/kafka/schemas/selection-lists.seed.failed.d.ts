import { z } from 'zod';
/**
 * Why a seed was rejected. Nothing was written for ANY of these — a seed is
 * all-or-nothing. `retryable` on the event says whether re-sending the SAME
 * request (same content, fresh attestation) can succeed later without a
 * content change; the default per code is listed in the plan.
 *
 *   SCOPE_UNSUPPORTED      scope 'user' — no user-scoped list model exists yet
 *   SEEDING_DISABLED       fuzefront.selection-lists.seed-defaults is OFF for this org      (retryable)
 *   ATTESTATION_INVALID    token inactive/expired, or lacks scope selection-lists:seed     (retryable)
 *   SOURCE_NOT_ALLOWED     source.app not in seed_sources, disabled, or token subject not bound to it
 *   NAMESPACE_VIOLATION    a list key outside the source's allowed key prefixes
 *   LIMIT_EXCEEDED         beyond the source's per-request caps (lists / items)
 *   QUOTA_EXCEEDED         would exceed the org's list quota or a list's item quota            (retryable)
 *   KEY_CONFLICT           a list key is taken by a list this source+pack did not seed         (retryable)
 *   PACK_CONTENT_MISMATCH  same (source, pack, version) already applied with DIFFERENT content
 *   ORG_UNKNOWN            organization not (yet) known to the service's org projection      (retryable)
 *   ORG_INACTIVE           organization is deactivated or deleted
 *   VALIDATION_ERROR       the request failed schema validation (best-effort; also dead-lettered)
 *   INTERNAL_ERROR         unexpected failure after retries were exhausted                    (retryable)
 */
export declare const SELECTION_LIST_SEED_FAILURE_REASONS: readonly ["SCOPE_UNSUPPORTED", "SEEDING_DISABLED", "ATTESTATION_INVALID", "SOURCE_NOT_ALLOWED", "NAMESPACE_VIOLATION", "LIMIT_EXCEEDED", "QUOTA_EXCEEDED", "KEY_CONFLICT", "PACK_CONTENT_MISMATCH", "ORG_UNKNOWN", "ORG_INACTIVE", "VALIDATION_ERROR", "INTERNAL_ERROR"];
/** `selection-lists.seed.failed` — the request was rejected; nothing was written. Never echoes the attestation. */
export declare const selectionListsSeedFailedSchemaV1: z.ZodObject<{
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
    reason: z.ZodEnum<["SCOPE_UNSUPPORTED", "SEEDING_DISABLED", "ATTESTATION_INVALID", "SOURCE_NOT_ALLOWED", "NAMESPACE_VIOLATION", "LIMIT_EXCEEDED", "QUOTA_EXCEEDED", "KEY_CONFLICT", "PACK_CONTENT_MISMATCH", "ORG_UNKNOWN", "ORG_INACTIVE", "VALIDATION_ERROR", "INTERNAL_ERROR"]>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    details: z.ZodArray<z.ZodObject<{
        listKey: z.ZodOptional<z.ZodString>;
        itemCode: z.ZodOptional<z.ZodString>;
        /** JSON path into the request, e.g. "lists.0.items.3.code". */
        path: z.ZodOptional<z.ZodString>;
        /** For QUOTA_EXCEEDED / LIMIT_EXCEEDED. */
        quotaScope: z.ZodOptional<z.ZodEnum<["org_lists", "list_items", "request_lists", "request_items"]>>;
        limit: z.ZodOptional<z.ZodNumber>;
        current: z.ZodOptional<z.ZodNumber>;
        requested: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        listKey?: string | undefined;
        itemCode?: string | undefined;
        path?: string | undefined;
        quotaScope?: "org_lists" | "list_items" | "request_lists" | "request_items" | undefined;
        limit?: number | undefined;
        current?: number | undefined;
        requested?: number | undefined;
    }, {
        listKey?: string | undefined;
        itemCode?: string | undefined;
        path?: string | undefined;
        quotaScope?: "org_lists" | "list_items" | "request_lists" | "request_items" | undefined;
        limit?: number | undefined;
        current?: number | undefined;
        requested?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    message: string;
    organizationId: string;
    reason: "SCOPE_UNSUPPORTED" | "SEEDING_DISABLED" | "ATTESTATION_INVALID" | "SOURCE_NOT_ALLOWED" | "NAMESPACE_VIOLATION" | "LIMIT_EXCEEDED" | "QUOTA_EXCEEDED" | "KEY_CONFLICT" | "PACK_CONTENT_MISMATCH" | "ORG_UNKNOWN" | "ORG_INACTIVE" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
    source: {
        app: string;
        service: string;
    };
    eventId: string;
    requestId: string | null;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    retryable: boolean;
    details: {
        listKey?: string | undefined;
        itemCode?: string | undefined;
        path?: string | undefined;
        quotaScope?: "org_lists" | "list_items" | "request_lists" | "request_items" | undefined;
        limit?: number | undefined;
        current?: number | undefined;
        requested?: number | undefined;
    }[];
    userId?: string | undefined;
}, {
    message: string;
    organizationId: string;
    reason: "SCOPE_UNSUPPORTED" | "SEEDING_DISABLED" | "ATTESTATION_INVALID" | "SOURCE_NOT_ALLOWED" | "NAMESPACE_VIOLATION" | "LIMIT_EXCEEDED" | "QUOTA_EXCEEDED" | "KEY_CONFLICT" | "PACK_CONTENT_MISMATCH" | "ORG_UNKNOWN" | "ORG_INACTIVE" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
    source: {
        app: string;
        service: string;
    };
    eventId: string;
    requestId: string | null;
    scope: "user" | "org";
    pack: {
        key: string;
        version: number;
    };
    trigger: "org-created" | "app-installed" | "app-upgraded" | "backfill" | "manual";
    retryable: boolean;
    details: {
        listKey?: string | undefined;
        itemCode?: string | undefined;
        path?: string | undefined;
        quotaScope?: "org_lists" | "list_items" | "request_lists" | "request_items" | undefined;
        limit?: number | undefined;
        current?: number | undefined;
        requested?: number | undefined;
    }[];
    userId?: string | undefined;
}>;
export type SelectionListsSeedFailedPayloadV1 = z.infer<typeof selectionListsSeedFailedSchemaV1>;
