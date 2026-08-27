/**
 * Structural (JSON-Schema) validation of the write-surface request bodies
 * (FFRNT-158 / FF-EPIC-17-S6): `ConfigWriteRequest`, `NamespaceCreate`,
 * `KeyDefinitionManifest`. Mirrors `services/config-service/openapi.yaml` —
 * the frozen contract — including every `additionalProperties: false`, so a
 * request carrying an unexpected field (e.g. a client-supplied `id`) is
 * refused structurally before any handler logic runs.
 *
 * Reuses `ajv` (already a dependency for src/validation/schema.ts) rather
 * than hand-rolled per-field checks — one compiled validator per shape,
 * matching the contract 1:1 is less error-prone than re-deriving the same
 * rules ad hoc in each route.
 */

import Ajv, { ValidateFunction } from 'ajv';

// `allErrors: false` for the same DoS reasoning as src/validation/schema.ts —
// unbounded error accumulation on attacker-sized bodies is not worth it; one
// error is enough to reject the whole request (details are exact-match, not
// "everything wrong with your JSON").
const ajv = new Ajv({ allErrors: false, strict: false });

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
}

function run(validate: ValidateFunction, body: unknown): ShapeValidationResult {
  const valid = validate(body);
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map((e) =>
    `${e.instancePath || '(body)'} ${e.message ?? 'is invalid'}`.trim(),
  );
  return { valid: false, errors };
}

// ── Scope ────────────────────────────────────────────────────────────────

const SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scopeType'],
  properties: {
    scopeType: { type: 'string', enum: ['platform', 'portal', 'org', 'user'] },
    scopeId: { type: ['string', 'null'] },
  },
};

// ── ConfigWriteRequest (PUT /v1/config) ─────────────────────────────────────

const CONFIG_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'op'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 200 },
    op: { type: 'string', enum: ['set', 'unset', 'lock', 'unlock'] },
    // Present-or-absent (not type-narrowed) — `value` may legitimately be any
    // JSON value, including `null`; per-op presence rules (required for
    // set/lock, rejected otherwise) are enforced in the route, which can tell
    // "key present with value null" apart from "key absent" (ajv/JSON Schema
    // cannot express that distinction against an already-parsed body).
    value: {},
    lockReason: { type: 'string', maxLength: 500 },
  },
};

const CONFIG_WRITE_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'scope', 'operations'],
  properties: {
    namespace: { type: 'string', minLength: 1, maxLength: 200 },
    scope: SCOPE_SCHEMA,
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: CONFIG_OPERATION_SCHEMA,
    },
    expectedVersion: { type: 'string' },
    reason: { type: 'string', maxLength: 500 },
  },
};

const validateConfigWriteRequest: ValidateFunction = ajv.compile(CONFIG_WRITE_REQUEST_SCHEMA);

export function validateWriteRequestShape(body: unknown): ShapeValidationResult {
  return run(validateConfigWriteRequest, body);
}

// ── NamespaceCreate (POST /v1/namespaces) ───────────────────────────────────

const NAMESPACE_CREATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'displayName'],
  properties: {
    namespace: {
      type: 'string',
      maxLength: 200,
      pattern: '^[a-z0-9]+(\\.[a-z0-9-]+)*$',
    },
    displayName: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    ownerAppId: { type: 'string' },
  },
};

const validateNamespaceCreate: ValidateFunction = ajv.compile(NAMESPACE_CREATE_SCHEMA);

export function validateNamespaceCreateShape(body: unknown): ShapeValidationResult {
  return run(validateNamespaceCreate, body);
}

// ── KeyDefinitionManifest (PUT /v1/namespaces/{namespace}/keys) ────────────

const KEY_DEFINITION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'displayName', 'valueType', 'defaultValue', 'allowedScopes'],
  properties: {
    key: {
      type: 'string',
      maxLength: 200,
      pattern: '^[a-z0-9]+(\\.[a-z0-9-]+)*$',
    },
    displayName: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    helpUrl: { type: 'string' },
    category: { type: 'string', maxLength: 100 },
    sortOrder: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    valueType: {
      type: 'string',
      enum: ['string', 'number', 'boolean', 'enum', 'json', 'duration', 'url', 'email', 'color', 'secret'],
    },
    schema: { type: 'object' },
    enumValues: { type: 'array' },
    defaultValue: {},
    allowedScopes: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: ['platform', 'portal', 'org', 'user'] },
    },
    isSystem: { type: 'boolean' },
    isHidden: { type: 'boolean' },
    isSecret: { type: 'boolean' },
    isReadonly: { type: 'boolean' },
    precedence: { type: 'string', enum: ['most-specific-wins', 'least-specific-wins'] },
    requiresRestart: { type: 'boolean' },
    replacedBy: { type: 'string' },
  },
};

const KEY_DEFINITION_MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['keys'],
  properties: {
    keys: { type: 'array', items: KEY_DEFINITION_INPUT_SCHEMA },
    complete: { type: 'boolean' },
  },
};

const validateKeyDefinitionManifest: ValidateFunction = ajv.compile(KEY_DEFINITION_MANIFEST_SCHEMA);

export function validateKeyDefinitionManifestShape(body: unknown): ShapeValidationResult {
  return run(validateKeyDefinitionManifest, body);
}

// ── RevealSecretRequest (POST /v1/config/secrets/reveal) — FF-EPIC-18 (FFRNT-280) ──

const REVEAL_SECRET_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'scope', 'key', 'reason'],
  properties: {
    namespace: { type: 'string', minLength: 1, maxLength: 200 },
    scope: SCOPE_SCHEMA,
    key: { type: 'string', minLength: 1, maxLength: 200 },
    // Required, not optional — unlike ConfigWriteRequest.reason — a reveal is
    // read access to a live secret, not a change a reviewer can reconstruct
    // from a diff (openapi.yaml RevealSecretRequest.reason).
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
};

const validateRevealSecretRequest: ValidateFunction = ajv.compile(REVEAL_SECRET_REQUEST_SCHEMA);

export function validateRevealSecretRequestShape(body: unknown): ShapeValidationResult {
  return run(validateRevealSecretRequest, body);
}
