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
  // messaging
  conversation: 'cnv',
  message: 'msg',
  notification: 'ntf',
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
