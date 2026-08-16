/**
 * Key-definition manifest reconciliation (FFRNT-158 / FF-EPIC-17-S6),
 * backing `PUT /v1/namespaces/{namespace}/keys` (`registerKeyDefinitions`).
 *
 * Declarative registration: an app publishes the definitions it owns and
 * this reconciles the catalog — created / updated / deprecated (never
 * deleted) / unchanged, per openapi.yaml's `registerKeyDefinitions`
 * description and `KeyDefinitionManifestResult`.
 *
 * DB-free / dependency-injected on purpose (mirrors resolver.ts's pure-core
 * style): the route wires this to repositories running inside ONE
 * transaction (via a `PoolClient`-backed repository pair) so "nothing was
 * written" on a 409 is literally true, not just "nothing SHOULD have been
 * written" — every conflict is detected before `deps.createDefinition` /
 * `updateDefinition` / `deprecateDefinitions` is called even once.
 */

import { KeyDefinition, KeyDefinitionEntityId, KeyDefinitionInput, NamespaceEntityId } from '../types';
import { validateValue } from '../validation/schema';

export interface KeyDefinitionManifestInput {
  keys: KeyDefinitionInput[];
  complete?: boolean;
}

export interface ReconcileManifestResult {
  created: string[];
  updated: string[];
  deprecated: string[];
  unchanged: string[];
}

export interface ManifestConflict {
  key: string;
  message: string;
}

/** S6: "A change ... incompatible with values already stored ... is refused as a whole, with the conflicting values reported." */
export class IncompatibleManifestError extends Error {
  constructor(public readonly conflicts: ManifestConflict[]) {
    super('manifest conflicts with values already stored at one or more scopes');
    this.name = 'IncompatibleManifestError';
  }
}

export interface KeyManifestDeps {
  listCurrent: () => Promise<KeyDefinition[]>;
  /** Every stored value row for one definition, at any scope — see ValueRepository.listAllForDefinition. */
  listStoredValues: (definitionId: KeyDefinitionEntityId) => Promise<{ scopeType: string; value: unknown }[]>;
  createDefinition: (input: KeyDefinitionInput) => Promise<KeyDefinition>;
  updateDefinition: (id: KeyDefinitionEntityId, input: KeyDefinitionInput) => Promise<KeyDefinition>;
  deprecateDefinitions: (ids: KeyDefinitionEntityId[]) => Promise<void>;
}

/** Canonical, default-applied projection of a `KeyDefinitionInput` for equality comparison. */
function normalizeInput(input: KeyDefinitionInput) {
  return {
    displayName: input.displayName,
    description: input.description ?? null,
    helpUrl: input.helpUrl ?? null,
    category: input.category ?? null,
    sortOrder: input.sortOrder ?? 0,
    tags: input.tags ?? [],
    valueType: input.valueType,
    schema: input.schema ?? null,
    enumValues: input.enumValues ?? null,
    defaultValue: input.defaultValue ?? null,
    allowedScopes: [...input.allowedScopes].sort(),
    isSystem: input.isSystem ?? false,
    isHidden: input.isHidden ?? false,
    isSecret: input.isSecret ?? false,
    isReadonly: input.isReadonly ?? false,
    precedence: input.precedence ?? 'most-specific-wins',
    requiresRestart: input.requiresRestart ?? false,
    replacedBy: input.replacedBy ?? null,
  };
}

function projectExisting(d: KeyDefinition) {
  return {
    displayName: d.displayName,
    description: d.description,
    helpUrl: d.helpUrl,
    category: d.category,
    sortOrder: d.sortOrder,
    tags: d.tags,
    valueType: d.valueType,
    schema: d.schema,
    enumValues: d.enumValues,
    defaultValue: d.defaultValue,
    allowedScopes: [...d.allowedScopes].sort(),
    isSystem: d.isSystem,
    isHidden: d.isHidden,
    isSecret: d.isSecret,
    isReadonly: d.isReadonly,
    precedence: d.precedence,
    requiresRestart: d.requiresRestart,
    replacedBy: d.replacedBy,
  };
}

function definitionUnchanged(existing: KeyDefinition, input: KeyDefinitionInput): boolean {
  if (existing.deprecatedAt !== null) return false; // reappearing in a manifest always revives it
  return JSON.stringify(projectExisting(existing)) === JSON.stringify(normalizeInput(input));
}

export async function reconcileKeyManifest(
  _namespaceId: NamespaceEntityId,
  manifest: KeyDefinitionManifestInput,
  deps: KeyManifestDeps,
): Promise<ReconcileManifestResult> {
  const current = await deps.listCurrent();
  const currentByKey = new Map(current.map((d) => [d.key, d]));
  const manifestKeys = new Set(manifest.keys.map((k) => k.key));

  const toCreate: KeyDefinitionInput[] = [];
  const toUpdate: { existing: KeyDefinition; input: KeyDefinitionInput }[] = [];
  const unchanged: string[] = [];
  const conflicts: ManifestConflict[] = [];

  for (const input of manifest.keys) {
    const existing = currentByKey.get(input.key);
    if (!existing) {
      toCreate.push(input);
      continue;
    }
    if (definitionUnchanged(existing, input)) {
      unchanged.push(input.key);
      continue;
    }

    // A `valueType`/`schema`/`enumValues` change can strand values already
    // stored under the OLD shape — check every stored value against the NEW
    // shape before this update is allowed to proceed at all.
    const shapeChanged =
      existing.valueType !== input.valueType ||
      JSON.stringify(existing.schema ?? null) !== JSON.stringify(input.schema ?? null) ||
      JSON.stringify(existing.enumValues ?? null) !== JSON.stringify(input.enumValues ?? null);

    if (shapeChanged) {
      const defaultCheck = validateValue(input.valueType, input.defaultValue, {
        schema: input.schema,
        enumValues: input.enumValues,
      });
      if (!defaultCheck.valid) {
        conflicts.push({
          key: input.key,
          message: `defaultValue does not satisfy its own (new) schema: ${defaultCheck.errors.join('; ')}`,
        });
      }

      const storedValues = await deps.listStoredValues(existing.id);
      for (const row of storedValues) {
        const result = validateValue(input.valueType, row.value, { schema: input.schema, enumValues: input.enumValues });
        if (!result.valid) {
          conflicts.push({
            key: input.key,
            message: `stored value at scope '${row.scopeType}' would no longer satisfy the new schema: ${result.errors.join('; ')}`,
          });
        }
      }
    }

    toUpdate.push({ existing, input });
  }

  if (conflicts.length > 0) {
    // Refused as a whole (S6): nothing below this point ever runs.
    throw new IncompatibleManifestError(conflicts);
  }

  const created: string[] = [];
  for (const input of toCreate) {
    await deps.createDefinition(input);
    created.push(input.key);
  }

  const updated: string[] = [];
  for (const { existing, input } of toUpdate) {
    await deps.updateDefinition(existing.id, input);
    updated.push(input.key);
  }

  const deprecated: string[] = [];
  if (manifest.complete) {
    const toDeprecate = current.filter((d) => !manifestKeys.has(d.key) && d.deprecatedAt === null);
    if (toDeprecate.length > 0) {
      await deps.deprecateDefinitions(toDeprecate.map((d) => d.id));
      deprecated.push(...toDeprecate.map((d) => d.key));
    }
  }

  return { created, updated, deprecated, unchanged };
}
