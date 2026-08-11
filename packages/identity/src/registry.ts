// The single source of truth mapping an entity type to its wire prefix.
//
// The prefix is what makes the cross-type collision attack structurally
// impossible: no string is simultaneously a valid `cus_…` and a valid `ord_…`,
// so a reference that arrives at the wrong endpoint is rejected by a string
// compare — no network call, no cache, no database. In a microservices split
// there is no shared unique index to lean on, so this check is the only
// defense that works offline. See governance/identifier-standard.md §2.
//
// Adding a type here is the ONLY way to mint ids for it. Prefixes are
// permanent once shipped: changing one is a wire-breaking change for every
// stored reference (Stripe re-prefixed invoice line items to `il_` and broke
// exactly the integrators who had parsed the old form).

/** Wire prefixes, keyed by entity type. Prefix must match `^[a-z][a-z_]{1,62}$`. */
export const ENTITY_PREFIXES = {
  // platform
  portal: 'prt',
  organization: 'org',
  user: 'usr',
  app: 'app',
  // billing
  customer: 'cus',
  subscription: 'sub',
  payment: 'pay',
  invoice: 'inv',
  credit: 'crd',
  // identity — the remaining spine entities the FFRNT-185 rollout mints.
  // Registered ahead of the call sites so the migration is a per-site edit
  // rather than a registry change per service. `ivt` not `inv`: invoice already
  // owns `inv`, and a prefix collision inside one registry would defeat the
  // whole point of the prefix.
  invitation: 'ivt',
  membership: 'mbr',
  session: 'ses',
  mfaFactor: 'mfa',
  // messaging
  conversation: 'cnv',
  message: 'msg',
  notification: 'ntf',
  // selection-list-service — product-local types, namespaced front_ per the
  // namespace gate (gate_identifier.py --namespace). Prefixes are permanent once
  // shipped: changing one is a wire-breaking change for every stored reference.
  selectionList: 'front_sl',
  selectionListItem: 'front_sli',
  // config-service (FF-EPIC-17) — bare spine prefixes, not front_-namespaced:
  // config-service is FuzeFront-hosted for the whole family (same tier as the
  // billing/messaging sets above), and the frozen contract
  // (services/config-service/openapi.yaml, FFRNT-153) already declares these as
  // bare `cns_`/`ckd_`. Mirrored in scripts/gate_identifier.py SPINE_PREFIXES so
  // `--namespace` accepts them.
  namespace: 'cns',
  keyDefinition: 'ckd',
} as const

export type EntityType = keyof typeof ENTITY_PREFIXES
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityType]

/** Reverse index, built once. Used to name the type in error messages. */
const TYPE_BY_PREFIX: Record<string, EntityType> = Object.freeze(
  Object.fromEntries(
    Object.entries(ENTITY_PREFIXES).map(([type, prefix]) => [prefix, type as EntityType])
  )
)

export function prefixFor(type: EntityType): EntityPrefix {
  return ENTITY_PREFIXES[type]
}

/** The entity type owning `prefix`, or null when the prefix is unregistered. */
export function typeForPrefix(prefix: string): EntityType | null {
  return TYPE_BY_PREFIX[prefix] ?? null
}

export function isEntityType(value: string): value is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITY_PREFIXES, value)
}

/** Every registered type, for gates and tests that need to enumerate. */
export const ENTITY_TYPES = Object.keys(ENTITY_PREFIXES) as readonly EntityType[]
