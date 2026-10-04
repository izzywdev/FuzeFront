"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slSeedOutcomeBaseV1 = exports.slSeedPackRefV1 = exports.slSeedSourceV1 = exports.slSeedTriggerV1 = exports.slSeedScopeV1 = exports.selectionListSeedPackSchemaV1 = exports.slSeedPackOrgTypeV1 = exports.slSeedListSpecV1 = exports.slSeedItemSpecV1 = exports.slSeedItemTranslationV1 = exports.slSeedListTranslationV1 = exports.slListEventBaseV1 = exports.slItemSnapshotV1 = exports.slListSnapshotV1 = exports.slSeedProvenanceV1 = exports.slActorV1 = exports.slTimestampV1 = exports.slListRevisionV1 = exports.slDescriptionV1 = exports.slNameV1 = exports.slLifecycleStatusV1 = exports.slRoleV1 = exports.slLocaleV1 = exports.slSlugV1 = exports.slItemCodeV1 = exports.slListKeyV1 = exports.slItemIdV1 = exports.slListIdV1 = exports.slUserIdV1 = exports.slOrganizationIdV1 = exports.slEventIdV1 = exports.SELECTION_LIST_SERVICE_PRINCIPAL = exports.PLATFORM_SEED_SOURCE = exports.SELECTION_LIST_ROLES = exports.SELECTION_LIST_LOCALES = exports.SELECTION_LIST_LIMITS = exports.SELECTION_LIST_SEED_REQUEST_ID_PATTERN = exports.SELECTION_LIST_SLUG_PATTERN = exports.SELECTION_LIST_ITEM_CODE_PATTERN = exports.SELECTION_LIST_KEY_PATTERN = void 0;
exports.refineSeedLists = refineSeedLists;
const zod_1 = require("zod");
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
/* ------------------------------------------------------------------------ */
/* Limits (mirrors services/selection-list-service/openapi.yaml + quotas)    */
/* ------------------------------------------------------------------------ */
exports.SELECTION_LIST_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
exports.SELECTION_LIST_ITEM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** App slug / seed-source / pack-key shape. Same alphabet as a list key. */
exports.SELECTION_LIST_SLUG_PATTERN = exports.SELECTION_LIST_KEY_PATTERN;
/** Caller-chosen seed request idempotency key. */
exports.SELECTION_LIST_SEED_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
exports.SELECTION_LIST_LIMITS = {
    NAME_MAX: 200,
    DESCRIPTION_MAX: 2000,
    /** Platform default quota for items in one list (services/selection-list-service quota.service.ts). */
    MAX_ITEMS_PER_LIST: 500,
    /** Hard cap on lists carried by ONE seed request / pack. */
    MAX_LISTS_PER_SEED: 20,
    /** Hard cap on items across all lists of ONE seed request / pack. */
    MAX_ITEMS_PER_SEED: 2000,
    /** Serialized payload ceiling for a seed request (Kafka default max message is 1 MiB). */
    MAX_SEED_REQUEST_BYTES: 900000,
    /** Opaque service token carried by a seed request's attestation. */
    MAX_ATTESTATION_TOKEN_LENGTH: 4096,
    /** Free-text message on seed.failed. */
    MESSAGE_MAX: 1000,
};
/** Supported locales — fixed by i18n.languages.json; widening this is a contract change. */
exports.SELECTION_LIST_LOCALES = [
    'en',
    'es',
    'fr',
    'de',
    'pt',
    'ru',
    'zh',
    'ja',
    'hi',
    'ar',
    'he',
];
/** ReBAC roles on one list instance. Roles do not stack. */
exports.SELECTION_LIST_ROLES = [
    'list-owner',
    'list-editor',
    'list-contributor',
    'list-translator',
    'list-viewer',
];
/** Reserved seed source for the service's own platform default packs. Never allowlistable. */
exports.PLATFORM_SEED_SOURCE = 'platform';
/** The system principal that performs seeding and lifecycle cascades. */
exports.SELECTION_LIST_SERVICE_PRINCIPAL = 'selection-list-service';
/* ------------------------------------------------------------------------ */
/* Scalars                                                                   */
/* ------------------------------------------------------------------------ */
exports.slEventIdV1 = zod_1.z.string().uuid();
exports.slOrganizationIdV1 = zod_1.z.string().max(255).regex(/^org_[0-9a-z]+$/);
exports.slUserIdV1 = zod_1.z.string().max(255).regex(/^usr_[0-9a-z]+$/);
exports.slListIdV1 = zod_1.z.string().max(255).regex(/^front_sl_[0-9a-z]+$/);
exports.slItemIdV1 = zod_1.z.string().max(255).regex(/^front_sli_[0-9a-z]+$/);
exports.slListKeyV1 = zod_1.z.string().min(2).max(64).regex(exports.SELECTION_LIST_KEY_PATTERN);
exports.slItemCodeV1 = zod_1.z.string().min(1).max(63).regex(exports.SELECTION_LIST_ITEM_CODE_PATTERN);
exports.slSlugV1 = zod_1.z.string().min(2).max(64).regex(exports.SELECTION_LIST_SLUG_PATTERN);
exports.slLocaleV1 = zod_1.z.enum(exports.SELECTION_LIST_LOCALES);
exports.slRoleV1 = zod_1.z.enum(exports.SELECTION_LIST_ROLES);
exports.slLifecycleStatusV1 = zod_1.z.enum(['active', 'archived']);
exports.slNameV1 = zod_1.z.string().min(1).max(exports.SELECTION_LIST_LIMITS.NAME_MAX);
exports.slDescriptionV1 = zod_1.z.string().max(exports.SELECTION_LIST_LIMITS.DESCRIPTION_MAX);
/** Monotonic per-list revision; bumps on every change to the list or anything inside it. */
exports.slListRevisionV1 = zod_1.z.number().int().positive();
exports.slTimestampV1 = zod_1.z.string().datetime();
/* ------------------------------------------------------------------------ */
/* Actor — who caused the change (a polymorphic reference => discriminated)  */
/* ------------------------------------------------------------------------ */
exports.slActorV1 = zod_1.z.discriminatedUnion('type', [
    /** An end user acting through the HTTP API. */
    zod_1.z.object({ type: zod_1.z.literal('user'), userId: exports.slUserIdV1 }),
    /**
     * The service itself: seeding (seedSource set) or a lifecycle cascade
     * (seedSource null). Never a user — see the plan's "system principal".
     */
    zod_1.z.object({
        type: zod_1.z.literal('system'),
        principal: zod_1.z.literal(exports.SELECTION_LIST_SERVICE_PRINCIPAL),
        seedSource: exports.slSlugV1.nullable(),
    }),
]);
/* ------------------------------------------------------------------------ */
/* Seed provenance + snapshots (event-carried state transfer)               */
/* ------------------------------------------------------------------------ */
/** Present when the row was created by seeding; null for user-authored rows. */
exports.slSeedProvenanceV1 = zod_1.z.object({
    source: exports.slSlugV1,
    packKey: exports.slSlugV1,
    packVersion: zod_1.z.number().int().positive(),
    /** True once a human has changed the seeded content; seeding never overwrites it again. */
    userModified: zod_1.z.boolean(),
});
/** A list as of the event. `name`/`description` are in `sourceLocale`. */
exports.slListSnapshotV1 = zod_1.z.object({
    listId: exports.slListIdV1,
    key: exports.slListKeyV1,
    sourceLocale: exports.slLocaleV1,
    status: exports.slLifecycleStatusV1,
    name: exports.slNameV1,
    description: exports.slDescriptionV1.nullable(),
    seed: exports.slSeedProvenanceV1.nullable(),
    createdAt: exports.slTimestampV1,
    updatedAt: exports.slTimestampV1,
});
/** An item as of the event. `label`/`description` are in the list's `sourceLocale`. */
exports.slItemSnapshotV1 = zod_1.z.object({
    itemId: exports.slItemIdV1,
    code: exports.slItemCodeV1,
    label: exports.slNameV1,
    description: exports.slDescriptionV1.nullable(),
    sortOrder: zod_1.z.number().int().nonnegative(),
    status: exports.slLifecycleStatusV1,
    seed: exports.slSeedProvenanceV1.nullable(),
    createdAt: exports.slTimestampV1,
    updatedAt: exports.slTimestampV1,
});
/** Fields every published list-scoped event carries. */
exports.slListEventBaseV1 = zod_1.z.object({
    eventId: exports.slEventIdV1,
    organizationId: exports.slOrganizationIdV1,
    actor: exports.slActorV1,
    listId: exports.slListIdV1,
    listKey: exports.slListKeyV1,
    listRevision: exports.slListRevisionV1,
});
/* ------------------------------------------------------------------------ */
/* Seed request content (shared by seed.requested and platform seed packs)   */
/* ------------------------------------------------------------------------ */
exports.slSeedListTranslationV1 = zod_1.z
    .object({ locale: exports.slLocaleV1, name: exports.slNameV1, description: exports.slDescriptionV1.optional() })
    .strict();
exports.slSeedItemTranslationV1 = zod_1.z
    .object({ locale: exports.slLocaleV1, label: exports.slNameV1, description: exports.slDescriptionV1.optional() })
    .strict();
/**
 * One item to seed. Carries NO id (the service mints `front_sli_…`) and is
 * strict, so an `id` cannot be smuggled in (governance/identifier-standard.md
 * §1). Position is the array index — `sortOrder` is assigned by the service.
 */
exports.slSeedItemSpecV1 = zod_1.z
    .object({
    code: exports.slItemCodeV1,
    label: exports.slNameV1,
    description: exports.slDescriptionV1.optional(),
    /** Non-source locales only; the source-locale text is `label`/`description`. */
    translations: zod_1.z.array(exports.slSeedItemTranslationV1).max(exports.SELECTION_LIST_LOCALES.length - 1).optional(),
})
    .strict();
/** One list to seed. Carries NO id; strict for the same reason as items. */
exports.slSeedListSpecV1 = zod_1.z
    .object({
    key: exports.slListKeyV1,
    sourceLocale: exports.slLocaleV1,
    name: exports.slNameV1,
    description: exports.slDescriptionV1.optional(),
    translations: zod_1.z.array(exports.slSeedListTranslationV1).max(exports.SELECTION_LIST_LOCALES.length - 1).optional(),
    items: zod_1.z.array(exports.slSeedItemSpecV1).max(exports.SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST),
})
    .strict();
/**
 * Cross-field rules for a set of seeded lists: unique list keys, unique item
 * codes per list, no translation for the source locale, no duplicate locale,
 * and the per-seed item ceiling. Applied by seed.requested AND by the platform
 * seed-pack schema so both are held to the same rules.
 */
function refineSeedLists(lists, ctx) {
    const keys = new Set();
    let totalItems = 0;
    lists.forEach((list, li) => {
        if (keys.has(list.key)) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: ['lists', li, 'key'], message: `duplicate list key "${list.key}"` });
        }
        keys.add(list.key);
        checkTranslations(list.translations, list.sourceLocale, ['lists', li, 'translations'], ctx);
        const codes = new Set();
        list.items.forEach((item, ii) => {
            if (codes.has(item.code)) {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    path: ['lists', li, 'items', ii, 'code'],
                    message: `duplicate item code "${item.code}" in list "${list.key}"`,
                });
            }
            codes.add(item.code);
            checkTranslations(item.translations, list.sourceLocale, ['lists', li, 'items', ii, 'translations'], ctx);
        });
        totalItems += list.items.length;
    });
    if (totalItems > exports.SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['lists'],
            message: `a seed may carry at most ${exports.SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED} items in total (got ${totalItems})`,
        });
    }
}
// `locale?` (not `locale`) on purpose: consumers that compile this source with
// `strict: false` (backend/jest.config.js maps @fuzefront/shared to src) get
// zod-inferred types whose properties are all optional.
function checkTranslations(translations, sourceLocale, path, ctx) {
    const seen = new Set();
    (translations !== null && translations !== void 0 ? translations : []).forEach((t, ti) => {
        if (t.locale === sourceLocale) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: [...path, ti, 'locale'],
                message: `translation locale "${t.locale}" is the source locale; put that text in name/label instead`,
            });
        }
        if (seen.has(t.locale)) {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: [...path, ti, 'locale'], message: `duplicate locale "${t.locale}"` });
        }
        seen.add(t.locale);
    });
}
/** The org types a platform pack may target (mirrors identity organizationSnapshotV1.type). */
exports.slSeedPackOrgTypeV1 = zod_1.z.enum(['platform', 'organization', 'personal']);
/**
 * Platform default seed pack — the on-disk format of
 * services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json.
 * NOT an event; it lives here so the pack files and seed.requested are
 * validated by one set of rules.
 */
exports.selectionListSeedPackSchemaV1 = zod_1.z
    .object({
    packKey: exports.slSlugV1,
    version: zod_1.z.number().int().positive(),
    appliesTo: zod_1.z.array(exports.slSeedPackOrgTypeV1).min(1),
    lists: zod_1.z.array(exports.slSeedListSpecV1).min(1).max(exports.SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED),
})
    .strict()
    .superRefine((pack, ctx) => refineSeedLists(pack.lists, ctx));
/* ------------------------------------------------------------------------ */
/* Seed outcome shared fields (completed / failed)                           */
/* ------------------------------------------------------------------------ */
exports.slSeedScopeV1 = zod_1.z.enum(['org', 'user']);
exports.slSeedTriggerV1 = zod_1.z.enum(['org-created', 'app-installed', 'app-upgraded', 'backfill', 'manual']);
/** Who asked. `app` is the seed source (allowlist key); `platform` for the service's own packs. */
exports.slSeedSourceV1 = zod_1.z.object({
    app: exports.slSlugV1,
    service: zod_1.z.string().min(1).max(128),
});
exports.slSeedPackRefV1 = zod_1.z.object({
    key: exports.slSlugV1,
    version: zod_1.z.number().int().positive(),
});
/** Fields shared by seed.completed and seed.failed. */
exports.slSeedOutcomeBaseV1 = zod_1.z.object({
    eventId: exports.slEventIdV1,
    /** Echo of seed.requested.requestId; null for platform seeds triggered by identity.org.created. */
    requestId: zod_1.z.string().regex(exports.SELECTION_LIST_SEED_REQUEST_ID_PATTERN).nullable(),
    organizationId: exports.slOrganizationIdV1,
    scope: exports.slSeedScopeV1,
    /** Present only for scope 'user'. */
    userId: exports.slUserIdV1.optional(),
    source: exports.slSeedSourceV1,
    pack: exports.slSeedPackRefV1,
    trigger: exports.slSeedTriggerV1,
});
