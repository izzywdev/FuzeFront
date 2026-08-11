/**
 * JSON-Schema validation helper (FF-EPIC-17-S2).
 *
 * A key's `valueType` implies a base JSON Schema; a key MAY additionally carry
 * a hand-authored `schema` that further constrains it. The two are combined
 * (never trusted to agree on their own) so a `number` key cannot silently
 * carry a `string` schema — see the S2 risk note in
 * docs/planning/epics/EPIC-17-configuration-service-core.md.
 */

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ValueType } from '../types';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Populated for `enum` rejections so the caller learns what was allowed (S2 AC2). */
  allowedValues?: unknown[];
}

const DURATION_PATTERN =
  '^P(?:\\d+Y)?(?:\\d+M)?(?:\\d+W)?(?:\\d+D)?(?:T(?:\\d+H)?(?:\\d+M)?(?:\\d+(?:\\.\\d+)?S)?)?$';
const COLOR_PATTERN = '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';

/**
 * The JSON Schema implied by a key's `valueType` alone (and `enumValues` for
 * `enum`). This is the base every stored/written value must satisfy before
 * any hand-authored `schema` narrows it further.
 */
export function baseSchemaFor(
  valueType: ValueType,
  enumValues?: unknown[] | null,
): Record<string, unknown> {
  switch (valueType) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      // enumValues may legitimately be empty at declaration time; an empty
      // `enum: []` rejects every value, which is the correct (if unusable)
      // behaviour for a key nobody has populated allowed values for yet.
      return { enum: enumValues ?? [] };
    case 'json':
      return {};
    case 'duration':
      return { type: 'string', pattern: DURATION_PATTERN };
    case 'url':
      return { type: 'string', format: 'uri' };
    case 'email':
      return { type: 'string', format: 'email' };
    case 'color':
      return { type: 'string', pattern: COLOR_PATTERN };
    case 'secret':
      return { type: 'string' };
    default:
      return {};
  }
}

/**
 * The effective schema for a key: the `valueType` base intersected with the
 * definition's own `schema`, if any, via `allOf`.
 */
export function effectiveSchemaFor(
  valueType: ValueType,
  customSchema?: Record<string, unknown> | null,
  enumValues?: unknown[] | null,
): Record<string, unknown> {
  const base = baseSchemaFor(valueType, enumValues);
  if (!customSchema || Object.keys(customSchema).length === 0) return base;
  return { allOf: [base, customSchema] };
}

/**
 * Validates `value` against a key's effective schema (base + custom,
 * intersected). Used both to reject an out-of-schema write (S2 AC2) and, at
 * resolution time, to detect a stored value that no longer satisfies a
 * definition whose schema changed after the value was written (S4 AC4).
 */
export function validateValue(
  valueType: ValueType,
  value: unknown,
  opts: { schema?: Record<string, unknown> | null; enumValues?: unknown[] | null } = {},
): ValidationResult {
  const schema = effectiveSchemaFor(valueType, opts.schema, opts.enumValues);

  let validate: ValidateFunction;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return { valid: false, errors: [`invalid schema: ${(err as Error).message}`] };
  }

  const valid = validate(value);
  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors ?? []).map((e) =>
    `${e.instancePath || '(value)'} ${e.message ?? 'is invalid'}`.trim(),
  );
  const result: ValidationResult = { valid: false, errors };
  if (valueType === 'enum') {
    result.allowedValues = opts.enumValues ?? [];
  }
  return result;
}

/**
 * Validates that a key definition's own `defaultValue` satisfies its own
 * schema (S2 AC4). An unsatisfiable key must never enter the catalog — the
 * resolution engine relies on this invariant to fall back to `defaultValue`
 * without re-validating it.
 */
export function validateDefaultValue(definition: {
  valueType: ValueType;
  defaultValue: unknown;
  schema?: Record<string, unknown> | null;
  enumValues?: unknown[] | null;
}): ValidationResult {
  return validateValue(definition.valueType, definition.defaultValue, {
    schema: definition.schema,
    enumValues: definition.enumValues,
  });
}
