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

/* ------------------------------------------------------------------------ */
/* Limits (mirrors services/selection-list-service/openapi.yaml + quotas)    */
/* ------------------------------------------------------------------------ */

export const SELECTION_LIST_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
export const SELECTION_LIST_ITEM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** App slug / seed-source / pack-key shape. Same alphabet as a list key. */
export const SELECTION_LIST_SLUG_PATTERN = SELECTION_LIST_KEY_PATTERN;
/** Caller-chosen seed request idempotency key. */
export const SELECTION_LIST_SEED_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const SELECTION_LIST_LIMITS = {
  NAME_MAX: 200,
  DESCRIPTION_MAX: 2000,
  /** Platform default quota for items in one list (services/selection-list-service quota.service.ts). */
  MAX_ITEMS_PER_LIST: 500,
  /** Hard cap on lists carried by ONE seed request / pack. */
  MAX_LISTS_PER_SEED: 20,
  /** Hard cap on items across all lists of ONE seed request / pack. */
  MAX_ITEMS_PER_SEED: 2000,
  /** Serialized payload ceiling for a seed request (Kafka default max message is 1 MiB). */
  MAX_SEED_REQUEST_BYTES: 900_000,
  /** Opaque service token carried by a seed request's attestation. */
  MAX_ATTESTATION_TOKEN_LENGTH: 4096,
  /** Free-text message on seed.failed. */
  MESSAGE_MAX: 1000,
} as const;

/** Supported locales — fixed by i18n.languages.json; widening this is a contract change. */
export const SELECTION_LIST_LOCALES = [
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
] as const;

/** ReBAC roles on one list instance. Roles do not stack. */
export const SELECTION_LIST_ROLES = [
  'list-owner',
  'list-editor',
  'list-contributor',
  'list-translator',
  'list-viewer',
] as const;

/** Reserved seed source for the service's own platform default packs. Never allowlistable. */
export const PLATFORM_SEED_SOURCE = 'platform';

/** The system principal that performs seeding and lifecycle cascades. */
export const SELECTION_LIST_SERVICE_PRINCIPAL = 'selection-list-service';

/* ------------------------------------------------------------------------ */
/* Scalars                                                                   */
/* ------------------------------------------------------------------------ */

export const slEventIdV1 = z.string().uuid();
export const slOrganizationIdV1 = z.string().max(255).regex(/^org_[0-9a-z]+$/);
export const slUserIdV1 = z.string().max(255).regex(/^usr_[0-9a-z]+$/);
export const slListIdV1 = z.string().max(255).regex(/^front_sl_[0-9a-z]+$/);
export const slItemIdV1 = z.string().max(255).regex(/^front_sli_[0-9a-z]+$/);
export const slListKeyV1 = z.string().min(2).max(64).regex(SELECTION_LIST_KEY_PATTERN);
export const slItemCodeV1 = z.string().min(1).max(63).regex(SELECTION_LIST_ITEM_CODE_PATTERN);
export const slSlugV1 = z.string().min(2).max(64).regex(SELECTION_LIST_SLUG_PATTERN);
export const slLocaleV1 = z.enum(SELECTION_LIST_LOCALES);
export const slRoleV1 = z.enum(SELECTION_LIST_ROLES);
export const slLifecycleStatusV1 = z.enum(['active', 'archived']);
export const slNameV1 = z.string().min(1).max(SELECTION_LIST_LIMITS.NAME_MAX);
export const slDescriptionV1 = z.string().max(SELECTION_LIST_LIMITS.DESCRIPTION_MAX);
/** Monotonic per-list revision; bumps on every change to the list or anything inside it. */
export const slListRevisionV1 = z.number().int().positive();
export const slTimestampV1 = z.string().datetime();

/* ------------------------------------------------------------------------ */
/* Actor — who caused the change (a polymorphic reference => discriminated)  */
/* ------------------------------------------------------------------------ */

export const slActorV1 = z.discriminatedUnion('type', [
  /** An end user acting through the HTTP API. */
  z.object({ type: z.literal('user'), userId: slUserIdV1 }),
  /**
   * The service itself: seeding (seedSource set) or a lifecycle cascade
   * (seedSource null). Never a user — see the plan's "system principal".
   */
  z.object({
    type: z.literal('system'),
    principal: z.literal(SELECTION_LIST_SERVICE_PRINCIPAL),
    seedSource: slSlugV1.nullable(),
  }),
]);
export type SelectionListActorV1 = z.infer<typeof slActorV1>;

/* ------------------------------------------------------------------------ */
/* Seed provenance + snapshots (event-carried state transfer)               */
/* ------------------------------------------------------------------------ */

/** Present when the row was created by seeding; null for user-authored rows. */
export const slSeedProvenanceV1 = z.object({
  source: slSlugV1,
  packKey: slSlugV1,
  packVersion: z.number().int().positive(),
  /** True once a human has changed the seeded content; seeding never overwrites it again. */
  userModified: z.boolean(),
});
export type SelectionListSeedProvenanceV1 = z.infer<typeof slSeedProvenanceV1>;

/** A list as of the event. `name`/`description` are in `sourceLocale`. */
export const slListSnapshotV1 = z.object({
  listId: slListIdV1,
  key: slListKeyV1,
  sourceLocale: slLocaleV1,
  status: slLifecycleStatusV1,
  name: slNameV1,
  description: slDescriptionV1.nullable(),
  seed: slSeedProvenanceV1.nullable(),
  createdAt: slTimestampV1,
  updatedAt: slTimestampV1,
});
export type SelectionListSnapshotV1 = z.infer<typeof slListSnapshotV1>;

/** An item as of the event. `label`/`description` are in the list's `sourceLocale`. */
export const slItemSnapshotV1 = z.object({
  itemId: slItemIdV1,
  code: slItemCodeV1,
  label: slNameV1,
  description: slDescriptionV1.nullable(),
  sortOrder: z.number().int().nonnegative(),
  status: slLifecycleStatusV1,
  seed: slSeedProvenanceV1.nullable(),
  createdAt: slTimestampV1,
  updatedAt: slTimestampV1,
});
export type SelectionListItemSnapshotV1 = z.infer<typeof slItemSnapshotV1>;

/** Fields every published list-scoped event carries. */
export const slListEventBaseV1 = z.object({
  eventId: slEventIdV1,
  organizationId: slOrganizationIdV1,
  actor: slActorV1,
  listId: slListIdV1,
  listKey: slListKeyV1,
  listRevision: slListRevisionV1,
});

/* ------------------------------------------------------------------------ */
/* Seed request content (shared by seed.requested and platform seed packs)   */
/* ------------------------------------------------------------------------ */

export const slSeedListTranslationV1 = z
  .object({ locale: slLocaleV1, name: slNameV1, description: slDescriptionV1.optional() })
  .strict();

export const slSeedItemTranslationV1 = z
  .object({ locale: slLocaleV1, label: slNameV1, description: slDescriptionV1.optional() })
  .strict();

/**
 * One item to seed. Carries NO id (the service mints `front_sli_…`) and is
 * strict, so an `id` cannot be smuggled in (governance/identifier-standard.md
 * §1). Position is the array index — `sortOrder` is assigned by the service.
 */
export const slSeedItemSpecV1 = z
  .object({
    code: slItemCodeV1,
    label: slNameV1,
    description: slDescriptionV1.optional(),
    /** Non-source locales only; the source-locale text is `label`/`description`. */
    translations: z.array(slSeedItemTranslationV1).max(SELECTION_LIST_LOCALES.length - 1).optional(),
  })
  .strict();
export type SelectionListSeedItemSpecV1 = z.infer<typeof slSeedItemSpecV1>;

/** One list to seed. Carries NO id; strict for the same reason as items. */
export const slSeedListSpecV1 = z
  .object({
    key: slListKeyV1,
    sourceLocale: slLocaleV1,
    name: slNameV1,
    description: slDescriptionV1.optional(),
    translations: z.array(slSeedListTranslationV1).max(SELECTION_LIST_LOCALES.length - 1).optional(),
    items: z.array(slSeedItemSpecV1).max(SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST),
  })
  .strict();
export type SelectionListSeedListSpecV1 = z.infer<typeof slSeedListSpecV1>;

/**
 * Cross-field rules for a set of seeded lists: unique list keys, unique item
 * codes per list, no translation for the source locale, no duplicate locale,
 * and the per-seed item ceiling. Applied by seed.requested AND by the platform
 * seed-pack schema so both are held to the same rules.
 */
export function refineSeedLists(lists: SelectionListSeedListSpecV1[], ctx: z.RefinementCtx): void {
  const keys = new Set<string>();
  let totalItems = 0;
  lists.forEach((list, li) => {
    if (keys.has(list.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lists', li, 'key'], message: `duplicate list key "${list.key}"` });
    }
    keys.add(list.key);
    checkTranslations(list.translations, list.sourceLocale, ['lists', li, 'translations'], ctx);
    const codes = new Set<string>();
    list.items.forEach((item, ii) => {
      if (codes.has(item.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lists', li, 'items', ii, 'code'],
          message: `duplicate item code "${item.code}" in list "${list.key}"`,
        });
      }
      codes.add(item.code);
      checkTranslations(item.translations, list.sourceLocale, ['lists', li, 'items', ii, 'translations'], ctx);
    });
    totalItems += list.items.length;
  });
  if (totalItems > SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lists'],
      message: `a seed may carry at most ${SELECTION_LIST_LIMITS.MAX_ITEMS_PER_SEED} items in total (got ${totalItems})`,
    });
  }
}

// `locale?` (not `locale`) on purpose: consumers that compile this source with
// `strict: false` (backend/jest.config.js maps @fuzefront/shared to src) get
// zod-inferred types whose properties are all optional.
function checkTranslations(
  translations: { locale?: string }[] | undefined,
  sourceLocale: string,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string | undefined>();
  (translations ?? []).forEach((t, ti) => {
    if (t.locale === sourceLocale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, ti, 'locale'],
        message: `translation locale "${t.locale}" is the source locale; put that text in name/label instead`,
      });
    }
    if (seen.has(t.locale)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, ti, 'locale'], message: `duplicate locale "${t.locale}"` });
    }
    seen.add(t.locale);
  });
}

/** The org types a platform pack may target (mirrors identity organizationSnapshotV1.type). */
export const slSeedPackOrgTypeV1 = z.enum(['platform', 'organization', 'personal']);

/**
 * Platform default seed pack — the on-disk format of
 * services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json.
 * NOT an event; it lives here so the pack files and seed.requested are
 * validated by one set of rules.
 */
export const selectionListSeedPackSchemaV1 = z
  .object({
    packKey: slSlugV1,
    version: z.number().int().positive(),
    appliesTo: z.array(slSeedPackOrgTypeV1).min(1),
    lists: z.array(slSeedListSpecV1).min(1).max(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED),
  })
  .strict()
  .superRefine((pack, ctx) => refineSeedLists(pack.lists, ctx));
export type SelectionListSeedPackV1 = z.infer<typeof selectionListSeedPackSchemaV1>;

/* ------------------------------------------------------------------------ */
/* Seed outcome shared fields (completed / failed)                           */
/* ------------------------------------------------------------------------ */

export const slSeedScopeV1 = z.enum(['org', 'user']);
export const slSeedTriggerV1 = z.enum(['org-created', 'app-installed', 'app-upgraded', 'backfill', 'manual']);

/** Who asked. `app` is the seed source (allowlist key); `platform` for the service's own packs. */
export const slSeedSourceV1 = z.object({
  app: slSlugV1,
  service: z.string().min(1).max(128),
});

export const slSeedPackRefV1 = z.object({
  key: slSlugV1,
  version: z.number().int().positive(),
});

/** Fields shared by seed.completed and seed.failed. */
export const slSeedOutcomeBaseV1 = z.object({
  eventId: slEventIdV1,
  /** Echo of seed.requested.requestId; null for platform seeds triggered by identity.org.created. */
  requestId: z.string().regex(SELECTION_LIST_SEED_REQUEST_ID_PATTERN).nullable(),
  organizationId: slOrganizationIdV1,
  scope: slSeedScopeV1,
  /** Present only for scope 'user'. */
  userId: slUserIdV1.optional(),
  source: slSeedSourceV1,
  pack: slSeedPackRefV1,
  trigger: slSeedTriggerV1,
});
