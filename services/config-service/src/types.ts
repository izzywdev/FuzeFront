/**
 * Internal domain types for config-service.
 *
 * These mirror the public contract projection shipped in
 * `config-client/src/types.ts` (generated from `services/config-service/openapi.yaml`,
 * the frozen contract) but are NOT that package — this service does not import
 * `@fuzefront/config-client` directly, matching the sibling services' convention
 * (e.g. `services/billing-service/src/types.ts` mirrors `@fuzefront/billing-client`
 * rather than importing it). Where the two disagree, the OpenAPI spec wins and
 * one of these two files is the bug.
 *
 * IDENTIFIERS: `Namespace.id` and `KeyDefinition.id` are server-minted TypeIDs
 * (`cns_…` / `ckd_…`, see governance/identifier-standard.md). Repository
 * signatures use the branded `EntityId<T>` from `@izzywdev/fuzefront-identity`
 * so a raw string can never be substituted for a minted id at compile time.
 */

import type { EntityId } from '@izzywdev/fuzefront-identity';

/** Branded TypeID of a configuration namespace (`cns_…`). */
export type NamespaceEntityId = EntityId<'namespace'>;
/** Branded TypeID of a key definition (`ckd_…`). */
export type KeyDefinitionEntityId = EntityId<'keyDefinition'>;

export type ScopeType = 'platform' | 'portal' | 'org' | 'user';

/** Every scope tier, in resolution order (least specific first). */
export const SCOPE_CHAIN: readonly ScopeType[] = ['platform', 'portal', 'org', 'user'] as const;

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
  | 'secret';

export const VALUE_TYPES: readonly ValueType[] = [
  'string',
  'number',
  'boolean',
  'enum',
  'json',
  'duration',
  'url',
  'email',
  'color',
  'secret',
];

export type Precedence = 'most-specific-wins' | 'least-specific-wins';

/** A point in the resolution chain. Polymorphic references always carry their type. */
export interface Scope {
  scopeType: ScopeType;
  /** Null exactly when `scopeType` is `platform`. */
  scopeId: string | null;
}

export interface Namespace {
  id: NamespaceEntityId;
  namespace: string;
  displayName: string;
  description: string | null;
  ownerAppId: string | null;
  createdAt: string;
}

/** Registration body. Never carries an `id` — the service mints it. */
export interface NamespaceCreateInput {
  namespace: string;
  displayName: string;
  description?: string;
  ownerAppId?: string;
}

export interface KeyDefinition {
  id: KeyDefinitionEntityId;
  namespaceId: NamespaceEntityId;
  key: string;
  displayName: string;
  description: string | null;
  helpUrl: string | null;
  category: string | null;
  sortOrder: number;
  tags: string[];
  valueType: ValueType;
  schema: Record<string, unknown> | null;
  enumValues: unknown[] | null;
  defaultValue: unknown;
  allowedScopes: ScopeType[];
  isSystem: boolean;
  isHidden: boolean;
  isSecret: boolean;
  isReadonly: boolean;
  precedence: Precedence;
  requiresRestart: boolean;
  deprecatedAt: string | null;
  replacedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One key as declared by an owning application. Never carries an `id`. */
export interface KeyDefinitionInput {
  key: string;
  displayName: string;
  description?: string;
  helpUrl?: string;
  category?: string;
  sortOrder?: number;
  tags?: string[];
  valueType: ValueType;
  schema?: Record<string, unknown>;
  enumValues?: unknown[];
  defaultValue: unknown;
  allowedScopes: ScopeType[];
  isSystem?: boolean;
  isHidden?: boolean;
  isSecret?: boolean;
  isReadonly?: boolean;
  precedence?: Precedence;
  requiresRestart?: boolean;
  replacedBy?: string;
}

/** One stored override row (a sparse value at one scope). */
export interface ConfigValue {
  id: string;
  definitionId: KeyDefinitionEntityId;
  scopeType: ScopeType;
  /** Null exactly when `scopeType` is `platform`. */
  scopeId: string | null;
  value: unknown;
  isLocked: boolean;
  lockReason: string | null;
  setByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One resolved setting, with provenance. This is the resolution engine's
 * output shape and mirrors `EffectiveConfigEntry` in the frozen contract.
 */
export interface EffectiveConfigEntry {
  key: string;
  value: unknown;
  /** Present only for `isSecret` keys, whose `value` is always null. */
  isSet?: boolean;
  source: Scope;
  locked: boolean;
  lockedBy: Scope | null;
  lockReason: string | null;
  editable: boolean;
  warning: string | null;
  definition: KeyDefinition;
}
