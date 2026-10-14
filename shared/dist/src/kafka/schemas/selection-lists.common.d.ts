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
/** Reserved seed source for the service's own platform default packs. Never allowlistable. */
export declare const PLATFORM_SEED_SOURCE = "platform";
/** The system principal that performs seeding and lifecycle cascades. */
export declare const SELECTION_LIST_SERVICE_PRINCIPAL = "selection-list-service";
export declare const slEventIdV1: any;
export declare const slOrganizationIdV1: any;
export declare const slUserIdV1: any;
export declare const slListIdV1: any;
export declare const slItemIdV1: any;
export declare const slListKeyV1: any;
export declare const slItemCodeV1: any;
export declare const slSlugV1: any;
export declare const slLocaleV1: any;
export declare const slRoleV1: any;
export declare const slLifecycleStatusV1: any;
export declare const slNameV1: any;
export declare const slDescriptionV1: any;
/** Monotonic per-list revision; bumps on every change to the list or anything inside it. */
export declare const slListRevisionV1: any;
export declare const slTimestampV1: any;
export declare const slActorV1: any;
export type SelectionListActorV1 = z.infer<typeof slActorV1>;
/** Present when the row was created by seeding; null for user-authored rows. */
export declare const slSeedProvenanceV1: any;
export type SelectionListSeedProvenanceV1 = z.infer<typeof slSeedProvenanceV1>;
/** A list as of the event. `name`/`description` are in `sourceLocale`. */
export declare const slListSnapshotV1: any;
export type SelectionListSnapshotV1 = z.infer<typeof slListSnapshotV1>;
/** An item as of the event. `label`/`description` are in the list's `sourceLocale`. */
export declare const slItemSnapshotV1: any;
export type SelectionListItemSnapshotV1 = z.infer<typeof slItemSnapshotV1>;
/** Fields every published list-scoped event carries. */
export declare const slListEventBaseV1: any;
export declare const slSeedListTranslationV1: any;
export declare const slSeedItemTranslationV1: any;
/**
 * One item to seed. Carries NO id (the service mints `front_sli_…`) and is
 * strict, so an `id` cannot be smuggled in (governance/identifier-standard.md
 * §1). Position is the array index — `sortOrder` is assigned by the service.
 */
export declare const slSeedItemSpecV1: any;
export type SelectionListSeedItemSpecV1 = z.infer<typeof slSeedItemSpecV1>;
/** One list to seed. Carries NO id; strict for the same reason as items. */
export declare const slSeedListSpecV1: any;
export type SelectionListSeedListSpecV1 = z.infer<typeof slSeedListSpecV1>;
/**
 * Cross-field rules for a set of seeded lists: unique list keys, unique item
 * codes per list, no translation for the source locale, no duplicate locale,
 * and the per-seed item ceiling. Applied by seed.requested AND by the platform
 * seed-pack schema so both are held to the same rules.
 */
export declare function refineSeedLists(lists: SelectionListSeedListSpecV1[], ctx: z.RefinementCtx): void;
/** The org types a platform pack may target (mirrors identity organizationSnapshotV1.type). */
export declare const slSeedPackOrgTypeV1: any;
/**
 * Platform default seed pack — the on-disk format of
 * services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json.
 * NOT an event; it lives here so the pack files and seed.requested are
 * validated by one set of rules.
 */
export declare const selectionListSeedPackSchemaV1: any;
export type SelectionListSeedPackV1 = z.infer<typeof selectionListSeedPackSchemaV1>;
export declare const slSeedScopeV1: any;
export declare const slSeedTriggerV1: any;
/** Who asked. `app` is the seed source (allowlist key); `platform` for the service's own packs. */
export declare const slSeedSourceV1: any;
export declare const slSeedPackRefV1: any;
/** Fields shared by seed.completed and seed.failed. */
export declare const slSeedOutcomeBaseV1: any;
