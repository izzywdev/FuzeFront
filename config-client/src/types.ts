/**
 * Types projected from `services/config-service/openapi.yaml` v1.0.0.
 *
 * The spec is the frozen contract; this file is a projection of it. Where the
 * two disagree, the spec wins and this file is the bug.
 */

/** TypeID prefix for a configuration namespace. */
export const NAMESPACE_ID_PREFIX = 'cns_' as const
/** TypeID prefix for a key definition. */
export const KEY_DEFINITION_ID_PREFIX = 'ckd_' as const

/** TypeID of a namespace (`cns_…`). Opaque past the prefix — never parse further. */
export type NamespaceId = `cns_${string}`
/** TypeID of a key definition (`ckd_…`). Opaque past the prefix. */
export type KeyDefinitionId = `ckd_${string}`

/** Dotted, lowercase namespace name owned by one application, e.g. `fuzefront.chat`. */
export type NamespaceName = string
/** Dotted, lowercase key path within a namespace, e.g. `ui.theme.density`. */
export type KeyName = string

/**
 * A tier of the resolution chain.
 *
 * `platform` is a singleton and carries no `scopeId`; the others identify a
 * portal, organization or user.
 */
export type ScopeType = 'platform' | 'portal' | 'org' | 'user'

/** Every scope tier, in resolution order (least specific first). */
export const SCOPE_CHAIN: readonly ScopeType[] = [
  'platform',
  'portal',
  'org',
  'user',
] as const

/** The kind of value a key holds. Drives validation and the input the editor renders. */
export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'json'
  | 'duration'
  | 'url'
  | 'email'
  | 'color'
  | 'secret'

/**
 * Which end of the chain wins.
 *
 * `most-specific-wins` (the default) lets a user's value beat their org's;
 * `least-specific-wins` reverses it so an org-level setting overrides a
 * user-specific one. The response shape is identical either way — no consumer
 * should branch on this.
 */
export type Precedence = 'most-specific-wins' | 'least-specific-wins'

/**
 * A point in the resolution chain.
 *
 * Polymorphic references always carry their type: a bare id is never resolved.
 */
export interface Scope {
  /** Which tier. */
  scopeType: ScopeType
  /** The portal, organization or user. Null exactly when `scopeType` is `platform`. */
  scopeId?: string | null
}

/** A configuration namespace owned by one application. */
export interface Namespace {
  /** Service-minted TypeID. */
  id: NamespaceId
  /** The dotted namespace name. */
  namespace: NamespaceName
  /** Human-facing name shown as the editor's section heading. */
  displayName: string
  /** What this namespace's settings govern. */
  description?: string | null
  /** The owning application in the app registry. */
  ownerAppId?: string | null
  /** When the namespace was first registered. */
  createdAt: string
}

/** Registration body. Carries no `id` — the service mints it. */
export interface NamespaceCreate {
  /** The dotted namespace name. */
  namespace: NamespaceName
  /** Human-facing name shown as the editor's section heading. */
  displayName: string
  /** What this namespace's settings govern. */
  description?: string
  /** The owning application in the app registry. */
  ownerAppId?: string
}

/** What a key *is*: presentation, validation, where it may be set, who may change it. */
export interface KeyDefinition {
  /** Service-minted TypeID. */
  id: KeyDefinitionId
  /** The dotted key path. */
  key: KeyName
  /** Label shown next to the input. */
  displayName: string
  /** Help text explaining what the setting does. */
  description?: string | null
  /** Link to fuller documentation. */
  helpUrl?: string | null
  /** Grouping heading in the editor. */
  category?: string | null
  /** Position within its category. Lower sorts first. */
  sortOrder?: number
  /** Free-form tags used for search and filtering. */
  tags?: string[]
  /** The kind of value this key holds. */
  valueType: ValueType
  /** JSON Schema the value must satisfy, intersected with the `valueType` base. */
  schema?: Record<string, unknown> | null
  /** Permitted values when `valueType` is `enum`. */
  enumValues?: unknown[] | null
  /** Bottom of the resolution chain. Always present, so every key resolves to something. */
  defaultValue: unknown
  /** The tiers at which this key may be set. */
  allowedScopes: ScopeType[]
  /** Platform-owned: metadata immutable to others, platform-only writes. */
  isSystem: boolean
  /** Omitted from ordinary reads entirely; visible only in the platform-admin catalog. */
  isHidden: boolean
  /** Encrypted at rest, masked on read, excluded from export. */
  isSecret: boolean
  /** Displayed but not editable at any tier. */
  isReadonly: boolean
  /** Which end of the chain wins for this key. */
  precedence: Precedence
  /** Changing it needs a consumer restart to take effect. */
  requiresRestart: boolean
  /** When the key was deprecated. Deprecated keys still resolve. */
  deprecatedAt?: string | null
  /** The key that supersedes this one, if any. */
  replacedBy?: string | null
}

/** One key as declared by an owning application. Carries no `id`. */
export interface KeyDefinitionInput {
  /** The dotted key path. */
  key: KeyName
  /** Label shown next to the input. */
  displayName: string
  /** Help text explaining what the setting does. */
  description?: string
  /** Link to fuller documentation. */
  helpUrl?: string
  /** Grouping heading in the editor. */
  category?: string
  /** Position within its category. */
  sortOrder?: number
  /** Free-form tags. */
  tags?: string[]
  /** The kind of value this key holds. */
  valueType: ValueType
  /** JSON Schema the value must satisfy. */
  schema?: Record<string, unknown>
  /** Permitted values when `valueType` is `enum`. */
  enumValues?: unknown[]
  /** Bottom of the chain. Must satisfy this key's own schema. */
  defaultValue: unknown
  /** The tiers at which this key may be set. */
  allowedScopes: ScopeType[]
  /** Platform-owned. */
  isSystem?: boolean
  /** Omitted from ordinary reads entirely. */
  isHidden?: boolean
  /** Encrypted at rest, masked on read. */
  isSecret?: boolean
  /** Displayed but not editable. */
  isReadonly?: boolean
  /** Which end of the chain wins. */
  precedence?: Precedence
  /** Warn that the change is not live until restart. */
  requiresRestart?: boolean
  /** The key that supersedes this one. */
  replacedBy?: string
}

/** The set of key definitions an application declares for one namespace. */
export interface KeyDefinitionManifest {
  /** Every key this manifest declares. */
  keys: KeyDefinitionInput[]
  /**
   * Whether this manifest is the **whole** catalog for the namespace.
   *
   * Only when true does an omitted key get deprecated. Requiring the manifest to
   * say so — rather than inferring deletion from absence — is what stops a
   * truncated or partially-generated manifest from deprecating half a namespace.
   */
  complete?: boolean
}

/** What reconciling a manifest changed. */
export interface KeyDefinitionManifestResult {
  /** Keys that did not previously exist. */
  created: KeyName[]
  /** Keys whose metadata changed. Their stored values are untouched. */
  updated: KeyName[]
  /** Keys absent from a `complete` manifest. Deprecated, never deleted. */
  deprecated: KeyName[]
  /** Keys the manifest matched exactly. */
  unchanged: KeyName[]
}

/**
 * One resolved setting.
 *
 * The provenance fields are the point. A consumer that reads only `value` cannot
 * tell a value set here from one inherited or locked, and will render a form
 * that misrepresents its own contents.
 */
export interface EffectiveConfigEntry {
  /** The key this entry resolves. */
  key: KeyName
  /** The resolved value. Always null for an `isSecret` key — see `isSet`. */
  value: unknown
  /** Whether a secret has a stored value. Present only for `isSecret` keys. */
  isSet?: boolean
  /** Which scope supplied the value. */
  source: Scope
  /** An ancestor pinned this value; writes beneath it are refused server-side. */
  locked: boolean
  /** Which scope holds the lock. Present exactly when `locked` is true. */
  lockedBy?: Scope | null
  /** Why the ancestor locked it, if a reason was recorded. */
  lockReason?: string | null
  /**
   * Whether **this caller** may change it at the scope being read.
   *
   * A disabled input is a courtesy; the server refuses the write regardless.
   */
  editable: boolean
  /**
   * Set when the stored value no longer satisfies its definition.
   *
   * The default is returned and this explains why, rather than failing — one
   * stale value must not break a consumer's boot.
   */
  warning?: string | null
  /** The key's full metadata. */
  definition: KeyDefinition
}

/** A scope's fully-resolved configuration for one namespace. */
export interface EffectiveConfig {
  /** The namespace resolved. */
  namespace: NamespaceName
  /** The scope resolved for. */
  scope: Scope
  /** Monotonic version of the resolved view, matching the `ETag`. */
  version: string
  /** One entry per visible key. Hidden keys are absent entirely. */
  entries: EffectiveConfigEntry[]
}

/**
 * What to do with one key at the target scope.
 *
 * `unset` removes this scope's override so the key resolves from its parent
 * again — not the same as setting the parent's current value, which pins a copy
 * that stops following it.
 */
export type ConfigOperationType = 'set' | 'unset' | 'lock' | 'unlock'

/** One operation against one key at the request's scope. */
export interface ConfigOperation {
  /** The key to operate on. */
  key: KeyName
  /** What to do. */
  op: ConfigOperationType
  /** The new value. Required for `set` and `lock`; rejected otherwise. */
  value?: unknown
  /** Why the value is being locked. Only meaningful with `lock`. */
  lockReason?: string
}

/** A batch of operations against one scope, applied as a single transaction. */
export interface ConfigWriteRequest {
  /** The namespace to write in. */
  namespace: NamespaceName
  /** The scope to write to. */
  scope: Scope
  /** The operations. All succeed or none do. */
  operations: ConfigOperation[]
  /** The version last read, for optimistic concurrency. */
  expectedVersion?: string
  /** Why the change is being made. Recorded in the audit trail. */
  reason?: string
}

/** The outcome of an applied batch. */
export interface ConfigWriteResult {
  /** The namespace written. */
  namespace: NamespaceName
  /** The scope written to. */
  scope: Scope
  /** The scope's new version, usable as the next `expectedVersion`. */
  version: string
  /** The keys changed, in request order. */
  applied: KeyName[]
}

/** Cursor pagination envelope. */
export interface PageInfo {
  /** Whether a further page exists. */
  hasNextPage: boolean
  /** Cursor for the next page. Null on the last page. */
  nextCursor?: string | null
}

/** A page of results. */
export interface Paged<T> {
  /** The items in this page. */
  items: T[]
  /** Pagination state. */
  pageInfo: PageInfo
}

/** Cursor pagination parameters. */
export interface PageParams {
  /** Opaque cursor from a previous page. Omit for the first page. */
  cursor?: string
  /** Maximum items to return (1–200, default 50). */
  limit?: number
}

/** Filters for listing key definitions. */
export interface ListKeyDefinitionsParams extends PageParams {
  /** Free-text filter over `displayName` and `description`. */
  search?: string
  /** Restrict to one presentation category. */
  category?: string
  /**
   * Include `isHidden` keys.
   *
   * Platform administrators only; any other caller passing `true` is refused
   * with 403 rather than silently receiving a filtered list.
   */
  includeHidden?: boolean
}

/** Machine-readable failure reason from the contract's error envelope. */
export type ConfigErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LOCKED_BY_ANCESTOR'
  | 'VERSION_CONFLICT'
  | 'SCOPE_NOT_ALLOWED'
  | 'INCOMPATIBLE_DEFINITION'
  | 'SECRET_UNAVAILABLE'
  | 'RATE_LIMITED'

/** One field- or key-level problem within a failed request. */
export interface ConfigErrorDetail {
  /** The configuration key this problem concerns, if key-specific. */
  key?: string | null
  /** The request field this problem concerns, if field-specific. */
  field?: string | null
  /** What is wrong, in human-facing terms. */
  message: string
  /** The values that would have been accepted, for enum rejections. */
  allowedValues?: unknown[] | null
}

/** The error envelope returned by every non-2xx response. */
export interface ConfigErrorBody {
  /** Branch on this, not on `message`. */
  code: ConfigErrorCode
  /** Human-facing explanation. May change without a contract version bump. */
  message: string
  /** The scope holding the lock. Present on `LOCKED_BY_ANCESTOR`. */
  lockedBy?: Scope | null
  /** The resolved view's actual version. Present on `VERSION_CONFLICT`. */
  currentVersion?: string | null
  /** Per-key or per-field problems. Present on validation failures. */
  details?: ConfigErrorDetail[] | null
}
