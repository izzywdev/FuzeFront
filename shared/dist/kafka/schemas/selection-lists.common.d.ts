import { z } from 'zod';
/**
 * Building blocks shared by every `selection-lists.*` event schema.
 *
 * Contract: docs/planning/selection-lists-events.md (design + decisions) and
 * docs/guides/SELECTION_LIST_EVENTS.md (consumer guide). The HTTP contract for
 * the same resources is services/selection-list-service/openapi.yaml; the
 * field limits below are copied from it and must move with it.
 *
 * Conventions that hold for EVERY selection-lists event:
 *
 *  - Field casing is camelCase (Kafka family convention), NOT the snake_case of
 *    the HTTP resources.
 *  - Ids are wire TypeIDs (`org_…`, `usr_…`, `front_sl_…`, `front_sli_…`),
 *    opaque past the prefix — never parse further, never assume a length.
 *    Unlike `identity.*` (bare UUIDs) these events carry the prefixed form,
 *    because that is the form this service stores and serves.
 *  - `organizationId` is ALWAYS a top-level field, so
 *    `partitionKeyForPayload()` keys every selection-lists event by org and all
 *    events for one org on one topic stay ordered on one partition.
 *  - `eventId` is a per-emission UUID: the consumer-side idempotency key. A
 *    redelivered event carries the same `eventId`.
 */
export declare const SELECTION_LIST_KEY_PATTERN: RegExp;
export declare const SELECTION_LIST_ITEM_CODE_PATTERN: RegExp;
/** App slug / seed-source / pack-key shape. Same alphabet as a list key. */
export declare const SELECTION_LIST_SLUG_PATTERN: RegExp;
/** Caller-chosen seed request idempotency key. */
export declare const SELECTION_LIST_SEED_REQUEST_ID_PATTERN: RegExp;
export declare const SELECTION_LIST_LIMITS: {
    readonly NAME_MAX: 200;
    readonly DESCRIPTION_MAX: 2000;
    /** Platform default quota for items in one list (services/selection-list-service quota.service.ts). */
    readonly MAX_ITEMS_PER_LIST: 500;
    /** Hard cap on lists carried by ONE seed request / pack. */
    readonly MAX_LISTS_PER_SEED: 20;
    /** Hard cap on items across all lists of ONE seed request / pack. */
    readonly MAX_ITEMS_PER_SEED: 2000;
    /** Serialized payload ceiling for a seed request (Kafka default max message is 1 MiB). */
    readonly MAX_SEED_REQUEST_BYTES: 900000;
    /** Opaque service token carried by a seed request's attestation. */
    readonly MAX_ATTESTATION_TOKEN_LENGTH: 4096;
    /** Free-text message on seed.failed. */
    readonly MESSAGE_MAX: 1000;
};
/** Supported locales — fixed by i18n.languages.json; widening this is a contract change. */
export declare const SELECTION_LIST_LOCALES: readonly ["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"];
/** ReBAC roles on one list instance. Roles do not stack. */
export declare const SELECTION_LIST_ROLES: readonly ["list-owner", "list-editor", "list-contributor", "list-translator", "list-viewer"];
/**
 * List visibility (HTTP contract 4.1.0, `SelectionListVisibility`): who may READ a
 * list without an instance grant. `private` (default) — instance-role holders only;
 * `org` — every member of the owning org; `platform` — a common list owned by the
 * platform organization, readable by every org. Never confers a mutation.
 */
export declare const SELECTION_LIST_VISIBILITIES: readonly ["private", "org", "platform"];
/** Upper bound of one fork's source→fork item map (mirrors the HTTP reorder/autofill item cap). */
export declare const SELECTION_LIST_MAX_FORK_ITEMS = 5000;
/** Reserved seed source for the service's own platform default packs. Never allowlistable. */
export declare const PLATFORM_SEED_SOURCE = "platform";
/** The system principal that performs seeding and lifecycle cascades. */
export declare const SELECTION_LIST_SERVICE_PRINCIPAL = "selection-list-service";
export declare const slEventIdV1: z.ZodString;
export declare const slOrganizationIdV1: z.ZodString;
export declare const slUserIdV1: z.ZodString;
export declare const slListIdV1: z.ZodString;
export declare const slItemIdV1: z.ZodString;
export declare const slListKeyV1: z.ZodString;
export declare const slItemCodeV1: z.ZodString;
export declare const slSlugV1: z.ZodString;
export declare const slLocaleV1: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
export declare const slRoleV1: z.ZodEnum<["list-owner", "list-editor", "list-contributor", "list-translator", "list-viewer"]>;
export declare const slLifecycleStatusV1: z.ZodEnum<["active", "archived"]>;
export declare const slVisibilityV1: z.ZodEnum<["private", "org", "platform"]>;
export declare const slNameV1: z.ZodString;
export declare const slDescriptionV1: z.ZodString;
/** Monotonic per-list revision; bumps on every change to the list or anything inside it. */
export declare const slListRevisionV1: z.ZodNumber;
export declare const slTimestampV1: z.ZodString;
export declare const slActorV1: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
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
export type SelectionListActorV1 = z.infer<typeof slActorV1>;
/** Present when the row was created by seeding; null for user-authored rows. */
export declare const slSeedProvenanceV1: z.ZodObject<{
    source: z.ZodString;
    packKey: z.ZodString;
    packVersion: z.ZodNumber;
    /** True once a human has changed the seeded content; seeding never overwrites it again. */
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
}>;
export type SelectionListSeedProvenanceV1 = z.infer<typeof slSeedProvenanceV1>;
/**
 * Where a forked list was copied from (HTTP `SelectionListForkProvenance`, 4.1.0).
 * Records the moment of copying; never updated. The source may since be purged.
 */
export declare const slForkProvenanceV1: z.ZodObject<{
    listId: z.ZodString;
    organizationId: z.ZodString;
    /** The source's `listRevision` when copied. */
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
}>;
export type SelectionListForkProvenanceV1 = z.infer<typeof slForkProvenanceV1>;
/** A list as of the event. `name`/`description` are in `sourceLocale`. */
export declare const slListSnapshotV1: z.ZodObject<{
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
        /** True once a human has changed the seeded content; seeding never overwrites it again. */
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
    /**
     * Additive (shared 1.3.0 / HTTP 4.1.0). Always set by a 4.1.0 producer; absent
     * from events produced before it, which means `private`.
     */
    visibility: z.ZodOptional<z.ZodEnum<["private", "org", "platform"]>>;
    /** Additive (1.3.0). Fork provenance; null (or absent, pre-1.3.0) when not a fork. */
    forkedFrom: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        listId: z.ZodString;
        organizationId: z.ZodString;
        /** The source's `listRevision` when copied. */
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
    key: string;
    name: string;
    status: "active" | "archived";
    listId: string;
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
    key: string;
    name: string;
    status: "active" | "archived";
    listId: string;
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
export type SelectionListSnapshotV1 = z.infer<typeof slListSnapshotV1>;
/** An item as of the event. `label`/`description` are in the list's `sourceLocale`. */
export declare const slItemSnapshotV1: z.ZodObject<{
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
        /** True once a human has changed the seeded content; seeding never overwrites it again. */
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
    /** Additive (1.3.0). On a forked item, the source item it was copied from; null/absent otherwise. */
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
export type SelectionListItemSnapshotV1 = z.infer<typeof slItemSnapshotV1>;
/** Fields every published list-scoped event carries. */
export declare const slListEventBaseV1: z.ZodObject<{
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
export declare const slSeedListTranslationV1: z.ZodObject<{
    locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    description?: string | undefined;
}, {
    name: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    description?: string | undefined;
}>;
export declare const slSeedItemTranslationV1: z.ZodObject<{
    locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    label: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    description?: string | undefined;
}, {
    label: string;
    locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    description?: string | undefined;
}>;
/**
 * One item to seed. Carries NO id (the service mints `front_sli_…`) and is
 * strict, so an `id` cannot be smuggled in (governance/identifier-standard.md
 * §1). Position is the array index — `sortOrder` is assigned by the service.
 */
export declare const slSeedItemSpecV1: z.ZodObject<{
    code: z.ZodString;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    /** Non-source locales only; the source-locale text is `label`/`description`. */
    translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        label: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }, {
        label: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }>, "many">>;
}, "strict", z.ZodTypeAny, {
    code: string;
    label: string;
    description?: string | undefined;
    translations?: {
        label: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }[] | undefined;
}, {
    code: string;
    label: string;
    description?: string | undefined;
    translations?: {
        label: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }[] | undefined;
}>;
export type SelectionListSeedItemSpecV1 = z.infer<typeof slSeedItemSpecV1>;
/** One list to seed. Carries NO id; strict for the same reason as items. */
export declare const slSeedListSpecV1: z.ZodObject<{
    key: z.ZodString;
    sourceLocale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }, {
        name: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }>, "many">>;
    items: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        /** Non-source locales only; the source-locale text is `label`/`description`. */
        translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }, {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }>, "many">>;
    }, "strict", z.ZodTypeAny, {
        code: string;
        label: string;
        description?: string | undefined;
        translations?: {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }, {
        code: string;
        label: string;
        description?: string | undefined;
        translations?: {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }>, "many">;
    /**
     * Additive (1.3.0, HTTP 4.1.0). Visibility of the seeded list; absent =
     * `private` (the pre-1.3.0 behaviour). `org` makes the seeded list readable
     * (pickable) by every member of the target org without a grant — the
     * recommended value for app reference data. `platform` is only valid in a
     * platform seed pack (one common instance, seeded into the platform
     * organization, not per org); `seed.requested` refuses it.
     */
    visibility: z.ZodOptional<z.ZodEnum<["private", "org", "platform"]>>;
}, "strict", z.ZodTypeAny, {
    key: string;
    name: string;
    sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    items: {
        code: string;
        label: string;
        description?: string | undefined;
        translations?: {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    description?: string | undefined;
    translations?: {
        name: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }[] | undefined;
    visibility?: "platform" | "private" | "org" | undefined;
}, {
    key: string;
    name: string;
    sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
    items: {
        code: string;
        label: string;
        description?: string | undefined;
        translations?: {
            label: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
    }[];
    description?: string | undefined;
    translations?: {
        name: string;
        locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        description?: string | undefined;
    }[] | undefined;
    visibility?: "platform" | "private" | "org" | undefined;
}>;
export type SelectionListSeedListSpecV1 = z.infer<typeof slSeedListSpecV1>;
/**
 * Cross-field rules for a set of seeded lists: unique list keys, unique item
 * codes per list, no translation for the source locale, no duplicate locale,
 * and the per-seed item ceiling. Applied by seed.requested AND by the platform
 * seed-pack schema so both are held to the same rules.
 */
export declare function refineSeedLists(lists: SelectionListSeedListSpecV1[], ctx: z.RefinementCtx): void;
/** The org types a platform pack may target (mirrors identity organizationSnapshotV1.type). */
export declare const slSeedPackOrgTypeV1: z.ZodEnum<["platform", "organization", "personal"]>;
/**
 * Platform default seed pack — the on-disk format of
 * services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json.
 * NOT an event; it lives here so the pack files and seed.requested are
 * validated by one set of rules.
 */
export declare const selectionListSeedPackSchemaV1: z.ZodEffects<z.ZodObject<{
    packKey: z.ZodString;
    version: z.ZodNumber;
    appliesTo: z.ZodArray<z.ZodEnum<["platform", "organization", "personal"]>, "many">;
    lists: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        sourceLocale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
            locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }, {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }>, "many">>;
        items: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            /** Non-source locales only; the source-locale text is `label`/`description`. */
            translations: z.ZodOptional<z.ZodArray<z.ZodObject<{
                locale: z.ZodEnum<["en", "es", "fr", "de", "pt", "ru", "zh", "ja", "hi", "ar", "he"]>;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }, {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }>, "many">>;
        }, "strict", z.ZodTypeAny, {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }, {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }>, "many">;
        /**
         * Additive (1.3.0, HTTP 4.1.0). Visibility of the seeded list; absent =
         * `private` (the pre-1.3.0 behaviour). `org` makes the seeded list readable
         * (pickable) by every member of the target org without a grant — the
         * recommended value for app reference data. `platform` is only valid in a
         * platform seed pack (one common instance, seeded into the platform
         * organization, not per org); `seed.requested` refuses it.
         */
        visibility: z.ZodOptional<z.ZodEnum<["private", "org", "platform"]>>;
    }, "strict", z.ZodTypeAny, {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }, {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    packKey: string;
    lists: {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }[];
    version: number;
    appliesTo: ("organization" | "platform" | "personal")[];
}, {
    packKey: string;
    lists: {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }[];
    version: number;
    appliesTo: ("organization" | "platform" | "personal")[];
}>, {
    packKey: string;
    lists: {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }[];
    version: number;
    appliesTo: ("organization" | "platform" | "personal")[];
}, {
    packKey: string;
    lists: {
        key: string;
        name: string;
        sourceLocale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
        items: {
            code: string;
            label: string;
            description?: string | undefined;
            translations?: {
                label: string;
                locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
                description?: string | undefined;
            }[] | undefined;
        }[];
        description?: string | undefined;
        translations?: {
            name: string;
            locale: "en" | "es" | "fr" | "de" | "pt" | "ru" | "zh" | "ja" | "hi" | "ar" | "he";
            description?: string | undefined;
        }[] | undefined;
        visibility?: "platform" | "private" | "org" | undefined;
    }[];
    version: number;
    appliesTo: ("organization" | "platform" | "personal")[];
}>;
export type SelectionListSeedPackV1 = z.infer<typeof selectionListSeedPackSchemaV1>;
export declare const slSeedScopeV1: z.ZodEnum<["org", "user"]>;
export declare const slSeedTriggerV1: z.ZodEnum<["org-created", "app-installed", "app-upgraded", "backfill", "manual"]>;
/** Who asked. `app` is the seed source (allowlist key); `platform` for the service's own packs. */
export declare const slSeedSourceV1: z.ZodObject<{
    app: z.ZodString;
    service: z.ZodString;
}, "strip", z.ZodTypeAny, {
    app: string;
    service: string;
}, {
    app: string;
    service: string;
}>;
export declare const slSeedPackRefV1: z.ZodObject<{
    key: z.ZodString;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    key: string;
    version: number;
}, {
    key: string;
    version: number;
}>;
/** Fields shared by seed.completed and seed.failed. */
export declare const slSeedOutcomeBaseV1: z.ZodObject<{
    eventId: z.ZodString;
    /** Echo of seed.requested.requestId; null for platform seeds triggered by identity.org.created. */
    requestId: z.ZodNullable<z.ZodString>;
    organizationId: z.ZodString;
    scope: z.ZodEnum<["org", "user"]>;
    /** Present only for scope 'user'. */
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
}, "strip", z.ZodTypeAny, {
    organizationId: string;
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
    userId?: string | undefined;
}, {
    organizationId: string;
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
    userId?: string | undefined;
}>;
