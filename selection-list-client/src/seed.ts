/**
 * Seed-request helpers — build a validated `selection-lists.seed.requested`
 * payload (and its envelope) for another service to publish to Kafka.
 *
 * Pure functions, zero runtime dependencies, no Kafka client: the caller
 * publishes the result with whatever producer it already has (e.g.
 * `TypedProducer` from `@fuzefront/shared/kafka`, which re-validates against
 * `selectionListsSeedRequestedSchemaV1`).
 *
 * The rules here MIRROR the frozen Zod schema in
 * `shared/src/kafka/schemas/selection-lists.seed.requested.ts`; the schema is
 * the source of truth. Both are pinned to the same golden fixtures
 * (`shared/tests/fixtures/selection-lists/`), so a drift fails a test.
 *
 * Guide: docs/guides/SELECTION_LIST_EVENTS.md.
 */

import { LOCALES, type Locale, type OrganizationId, type UserId } from './types'

/** Kafka topic a seed request is published to. */
export const SEED_REQUESTED_TOPIC = 'selection-lists.seed.requested'
/** Topic the service answers a successful seed on. */
export const SEED_COMPLETED_TOPIC = 'selection-lists.seed.completed'
/** Topic the service answers a rejected seed on. */
export const SEED_FAILED_TOPIC = 'selection-lists.seed.failed'
/** Envelope schema version for `SeedRequestedPayloadV1`. */
export const SEED_REQUESTED_SCHEMA_VERSION = '1.0'

/** Limits mirrored from the contract (shared `SELECTION_LIST_LIMITS`). */
export const SEED_LIMITS = {
  NAME_MAX: 200,
  DESCRIPTION_MAX: 2000,
  MAX_LISTS_PER_SEED: 20,
  MAX_ITEMS_PER_LIST: 500,
  MAX_ITEMS_PER_SEED: 2000,
  MAX_SEED_REQUEST_BYTES: 900_000,
  MAX_ATTESTATION_TOKEN_LENGTH: 4096,
} as const

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ORG_RE = /^org_[0-9a-z]+$/
const USR_RE = /^usr_[0-9a-z]+$/
const PLATFORM = 'platform'

export type SeedScope = 'org' | 'user'
export type SeedTrigger = 'org-created' | 'app-installed' | 'app-upgraded' | 'backfill' | 'manual'

export interface SeedListTranslation {
  locale: Locale
  name: string
  description?: string
}

export interface SeedItemTranslation {
  locale: Locale
  label: string
  description?: string
}

/** One item to seed. No id — the service mints it. Position = array index. */
export interface SeedItemSpec {
  code: string
  label: string
  description?: string
  translations?: SeedItemTranslation[]
}

/** One list to seed, as it appears on the wire. */
export interface SeedListSpec {
  key: string
  sourceLocale: Locale
  name: string
  description?: string
  translations?: SeedListTranslation[]
  items: SeedItemSpec[]
  /**
   * Visibility of the seeded list (shared 1.3.0 / HTTP 4.1.0). Absent = `private`
   * (only grant-holders can read it). `org` lets every member of the org pick
   * from it without a grant — recommended for app reference data. App seed
   * requests can never create a `platform` (common) list.
   */
  visibility?: 'private' | 'org'
}

/** Wire payload of `selection-lists.seed.requested` (v1). */
export interface SeedRequestedPayloadV1 {
  requestId: string
  organizationId: OrganizationId
  scope: SeedScope
  userId?: UserId
  source: { app: string; service: string }
  pack: { key: string; version: number }
  trigger: SeedTrigger
  attestation: { kind: 'service-token'; token: string }
  lists: SeedListSpec[]
}

/** The family event envelope (`FuzeEvent` in `@fuzefront/shared/kafka`). */
export interface SeedRequestedEnvelopeV1 {
  version: string
  topic: typeof SEED_REQUESTED_TOPIC
  correlationId: string
  occurredAt: string
  payload: SeedRequestedPayloadV1
}

/** Input to {@link buildSeedRequest}: the wire shape, with ergonomic defaults. */
export interface BuildSeedRequestInput {
  /** Idempotency key echoed on the outcome; prefer `<app>:<org>:<packKey>:v<version>`. */
  requestId: string
  /** `org_…` TypeID. Convert a bare UUID from `identity.org.created` with `fromUuid('organization', id)`. */
  organizationId: OrganizationId
  /** The requesting app's registry slug (seed source + default key namespace). */
  app: string
  /** The producing service's name. */
  service: string
  packKey: string
  packVersion: number
  /** Short-lived service token with scope `selection-lists:seed` — mint a dedicated one. */
  serviceToken: string
  /** Defaults to `'org'`. `'user'` is answered with `SCOPE_UNSUPPORTED` until user-scoped lists exist. */
  scope?: SeedScope
  userId?: UserId
  /** Defaults to `'app-installed'`. */
  trigger?: SeedTrigger
  /**
   * Required list-key prefix. Defaults to `` `${app}-` `` (the default namespace
   * every allowlist entry grants). Pass `''` only when the allowlist grants
   * your app another namespace.
   */
  keyPrefix?: string
  lists: Array<Omit<SeedListSpec, 'sourceLocale'> & { sourceLocale?: Locale }>
}

export interface SeedRequestIssue {
  /** Dotted path into the payload, e.g. `lists.0.items.3.code`. */
  path: string
  message: string
}

/** Thrown when the input cannot produce a contract-valid seed request. */
export class SeedRequestValidationError extends Error {
  readonly issues: SeedRequestIssue[]

  constructor(issues: SeedRequestIssue[]) {
    super(`invalid seed request: ${issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ')}`)
    this.name = 'SeedRequestValidationError'
    this.issues = issues
  }
}

const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES)
const LIST_FIELDS = new Set(['key', 'sourceLocale', 'name', 'description', 'translations', 'items', 'visibility'])
const ITEM_FIELDS = new Set(['code', 'label', 'description', 'translations'])
const LIST_TR_FIELDS = new Set(['locale', 'name', 'description'])
const ITEM_TR_FIELDS = new Set(['locale', 'label', 'description'])

/**
 * Builds and validates a `selection-lists.seed.requested` payload.
 * Throws {@link SeedRequestValidationError} listing EVERY problem found.
 */
export function buildSeedRequest(input: BuildSeedRequestInput): SeedRequestedPayloadV1 {
  const issues: SeedRequestIssue[] = []
  const add = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  const scope: SeedScope = input.scope ?? 'org'
  const trigger: SeedTrigger = input.trigger ?? 'app-installed'
  const prefix = input.keyPrefix ?? `${input.app}-`

  checkPattern(input.requestId, REQUEST_ID_RE, 'requestId', add)
  checkPattern(input.organizationId, ORG_RE, 'organizationId', add, 255)
  checkSlug(input.app, 'source.app', add)
  if (input.app === PLATFORM) add('source.app', `"${PLATFORM}" is reserved for the service's own packs`)
  if (typeof input.service !== 'string' || input.service.length < 1 || input.service.length > 128) {
    add('source.service', 'must be 1-128 characters')
  }
  checkSlug(input.packKey, 'pack.key', add)
  if (!Number.isInteger(input.packVersion) || input.packVersion < 1) add('pack.version', 'must be a positive integer')
  if (
    typeof input.serviceToken !== 'string' ||
    input.serviceToken.length < 1 ||
    input.serviceToken.length > SEED_LIMITS.MAX_ATTESTATION_TOKEN_LENGTH
  ) {
    add('attestation.token', `must be 1-${SEED_LIMITS.MAX_ATTESTATION_TOKEN_LENGTH} characters`)
  }
  if (scope !== 'org' && scope !== 'user') add('scope', 'must be "org" or "user"')
  if (scope === 'user') {
    if (input.userId === undefined) add('userId', 'is required when scope is "user"')
    else checkPattern(input.userId, USR_RE, 'userId', add, 255)
  } else if (input.userId !== undefined) {
    add('userId', 'must be omitted when scope is "org"')
  }
  if (!['org-created', 'app-installed', 'app-upgraded', 'backfill', 'manual'].includes(trigger)) {
    add('trigger', 'is not a supported trigger')
  }

  const rawLists = Array.isArray(input.lists) ? input.lists : []
  if (!Array.isArray(input.lists)) add('lists', 'must be an array')
  if (rawLists.length < 1) add('lists', 'must contain at least one list')
  if (rawLists.length > SEED_LIMITS.MAX_LISTS_PER_SEED) {
    add('lists', `at most ${SEED_LIMITS.MAX_LISTS_PER_SEED} lists per request`)
  }

  const listKeys = new Set<string>()
  let totalItems = 0
  const lists: SeedListSpec[] = rawLists.map((raw, li) => {
    const p = `lists.${li}`
    checkUnknown(raw, LIST_FIELDS, p, add)
    const sourceLocale = (raw.sourceLocale ?? 'en') as Locale
    if (!LOCALE_SET.has(sourceLocale)) add(`${p}.sourceLocale`, `unsupported locale "${sourceLocale}"`)
    checkSlug(raw.key, `${p}.key`, add)
    if (typeof raw.key === 'string' && prefix && !raw.key.startsWith(prefix)) {
      add(`${p}.key`, `must start with the namespace prefix "${prefix}"`)
    }
    if (listKeys.has(raw.key)) add(`${p}.key`, `duplicate list key "${raw.key}"`)
    listKeys.add(raw.key)
    checkText(raw.name, `${p}.name`, add)
    checkDescription(raw.description, `${p}.description`, add)
    checkTranslations(raw.translations, 'name', LIST_TR_FIELDS, sourceLocale, `${p}.translations`, add)
    const visibility = (raw as { visibility?: unknown }).visibility
    if (visibility !== undefined && visibility !== 'private' && visibility !== 'org') {
      add(
        `${p}.visibility`,
        visibility === 'platform'
          ? 'an app seed request cannot create a platform (common) list; use "org" or "private"'
          : 'must be "private" or "org"'
      )
    }

    const rawItems = Array.isArray(raw.items) ? raw.items : []
    if (!Array.isArray(raw.items)) add(`${p}.items`, 'must be an array')
    if (rawItems.length > SEED_LIMITS.MAX_ITEMS_PER_LIST) {
      add(`${p}.items`, `at most ${SEED_LIMITS.MAX_ITEMS_PER_LIST} items per list`)
    }
    totalItems += rawItems.length
    const codes = new Set<string>()
    const items: SeedItemSpec[] = rawItems.map((item, ii) => {
      const ip = `${p}.items.${ii}`
      checkUnknown(item, ITEM_FIELDS, ip, add)
      checkPattern(item.code, CODE_RE, `${ip}.code`, add, 63)
      if (codes.has(item.code)) add(`${ip}.code`, `duplicate item code "${item.code}" in list "${raw.key}"`)
      codes.add(item.code)
      checkText(item.label, `${ip}.label`, add)
      checkDescription(item.description, `${ip}.description`, add)
      checkTranslations(item.translations, 'label', ITEM_TR_FIELDS, sourceLocale, `${ip}.translations`, add)
      return compact({
        code: item.code,
        label: item.label,
        description: item.description,
        translations: item.translations?.map((t) => compact({ ...t })),
      }) as SeedItemSpec
    })

    return compact({
      key: raw.key,
      sourceLocale,
      name: raw.name,
      description: raw.description,
      translations: raw.translations?.map((t) => compact({ ...t })),
      items,
      visibility: raw.visibility,
    }) as SeedListSpec
  })

  if (totalItems > SEED_LIMITS.MAX_ITEMS_PER_SEED) {
    add('lists', `at most ${SEED_LIMITS.MAX_ITEMS_PER_SEED} items in total per request (got ${totalItems})`)
  }

  const payload: SeedRequestedPayloadV1 = {
    requestId: input.requestId,
    organizationId: input.organizationId,
    scope,
    ...(scope === 'user' && input.userId !== undefined ? { userId: input.userId } : {}),
    source: { app: input.app, service: input.service },
    pack: { key: input.packKey, version: input.packVersion },
    trigger,
    attestation: { kind: 'service-token', token: input.serviceToken },
    lists,
  }

  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  if (bytes > SEED_LIMITS.MAX_SEED_REQUEST_BYTES) {
    add('', `serialized request is ${bytes} bytes; the limit is ${SEED_LIMITS.MAX_SEED_REQUEST_BYTES} — split the pack`)
  }

  if (issues.length > 0) throw new SeedRequestValidationError(issues)
  return payload
}

/**
 * Wraps a payload in the family envelope. `occurredAt` defaults to now; pass
 * it explicitly for deterministic output.
 */
export function buildSeedRequestEnvelope(
  payload: SeedRequestedPayloadV1,
  options: { correlationId: string; occurredAt?: string },
): SeedRequestedEnvelopeV1 {
  return {
    version: SEED_REQUESTED_SCHEMA_VERSION,
    topic: SEED_REQUESTED_TOPIC,
    correlationId: options.correlationId,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload,
  }
}

/** Kafka message key for a seed request — the org, so one org's requests stay ordered. */
export function seedRequestKafkaKey(payload: SeedRequestedPayloadV1): string {
  return payload.organizationId
}

/* -------------------------------------------------------------------------- */

type Add = (path: string, message: string) => void

function checkPattern(value: unknown, re: RegExp, path: string, add: Add, maxLength?: number): void {
  if (typeof value !== 'string' || !re.test(value) || (maxLength !== undefined && value.length > maxLength)) {
    add(path, `must match ${re.source}`)
  }
}

function checkSlug(value: unknown, path: string, add: Add): void {
  checkPattern(value, KEY_RE, path, add, 64)
}

function checkText(value: unknown, path: string, add: Add): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > SEED_LIMITS.NAME_MAX) {
    add(path, `must be 1-${SEED_LIMITS.NAME_MAX} characters`)
  }
}

function checkDescription(value: unknown, path: string, add: Add): void {
  if (value === undefined) return
  if (typeof value !== 'string' || value.length > SEED_LIMITS.DESCRIPTION_MAX) {
    add(path, `must be a string of at most ${SEED_LIMITS.DESCRIPTION_MAX} characters`)
  }
}

function checkUnknown(value: unknown, allowed: ReadonlySet<string>, path: string, add: Add): void {
  if (value === null || typeof value !== 'object') {
    add(path, 'must be an object')
    return
  }
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) add(`${path}.${k}`, k === 'id' ? 'ids are minted by the service; do not send one' : 'unknown field')
  }
}

function checkTranslations(
  value: unknown,
  textField: 'name' | 'label',
  allowed: ReadonlySet<string>,
  sourceLocale: string,
  path: string,
  add: Add,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    add(path, 'must be an array')
    return
  }
  if (value.length > LOCALES.length - 1) add(path, `at most ${LOCALES.length - 1} translations`)
  const seen = new Set<string>()
  value.forEach((t: Record<string, unknown>, i) => {
    const tp = `${path}.${i}`
    checkUnknown(t, allowed, tp, add)
    const locale = t?.locale as string
    if (!LOCALE_SET.has(locale)) add(`${tp}.locale`, `unsupported locale "${String(locale)}"`)
    if (locale === sourceLocale) add(`${tp}.locale`, `"${locale}" is the source locale; put that text in ${textField}`)
    if (seen.has(locale)) add(`${tp}.locale`, `duplicate locale "${locale}"`)
    seen.add(locale)
    checkText(t?.[textField], `${tp}.${textField}`, add)
    checkDescription(t?.description, `${tp}.description`, add)
  })
}

/** Drops `undefined` members so the wire payload has no `"key": undefined`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
  return obj
}
