import { baseSchemaFor, effectiveSchemaFor, validateDefaultValue, validateValue } from '../../src/validation/schema';

describe('baseSchemaFor', () => {
  it('derives {type: string} for a string key', () => {
    expect(baseSchemaFor('string')).toEqual({ type: 'string' });
  });

  it('derives {type: number} for a number key', () => {
    expect(baseSchemaFor('number')).toEqual({ type: 'number' });
  });

  it('derives an enum schema from enumValues', () => {
    expect(baseSchemaFor('enum', ['a', 'b', 'c'])).toEqual({ enum: ['a', 'b', 'c'] });
  });

  it('derives an empty enum when enumValues is absent (rejects everything, safely)', () => {
    expect(baseSchemaFor('enum')).toEqual({ enum: [] });
  });

  it('derives an unconstrained schema for json', () => {
    expect(baseSchemaFor('json')).toEqual({});
  });
});

describe('validateValue — base valueType enforcement', () => {
  it('accepts a matching string value', () => {
    expect(validateValue('string', 'hello').valid).toBe(true);
  });

  it('rejects a number where the valueType is string', () => {
    const result = validateValue('string', 42);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a string where the valueType is number', () => {
    // S2 risk note: a `number` key must never silently accept a value that
    // only a hand-authored schema disagreeing with valueType would let through.
    const result = validateValue('number', '42');
    expect(result.valid).toBe(false);
  });

  it('accepts a boolean value for a boolean key', () => {
    expect(validateValue('boolean', true).valid).toBe(true);
  });
});

describe('validateValue — enum (S2 AC2)', () => {
  const enumValues = ['light', 'dark', 'system'];

  it('accepts a value in the enum', () => {
    expect(validateValue('enum', 'dark', { enumValues }).valid).toBe(true);
  });

  it('rejects a value outside the enum and NAMES the allowed values', () => {
    const result = validateValue('enum', 'purple', { enumValues });
    expect(result.valid).toBe(false);
    expect(result.allowedValues).toEqual(enumValues);
  });
});

describe('validateValue — format-typed valueTypes', () => {
  it('accepts a well-formed url', () => {
    expect(validateValue('url', 'https://fuzefront.example.com/settings').valid).toBe(true);
  });

  it('rejects a malformed url', () => {
    expect(validateValue('url', 'not a url').valid).toBe(false);
  });

  it('accepts a well-formed email', () => {
    expect(validateValue('email', 'ops@fuzefront.example.com').valid).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(validateValue('email', 'not-an-email').valid).toBe(false);
  });

  it('accepts a well-formed 6-digit hex color', () => {
    expect(validateValue('color', '#1a2b3c').valid).toBe(true);
  });

  it('rejects a malformed color', () => {
    expect(validateValue('color', 'blueish').valid).toBe(false);
  });

  it('accepts a well-formed ISO-8601 duration', () => {
    expect(validateValue('duration', 'P1DT12H').valid).toBe(true);
  });

  it('rejects a malformed duration', () => {
    expect(validateValue('duration', '2 days').valid).toBe(false);
  });
});

describe('effectiveSchemaFor — base intersected with a hand-authored schema', () => {
  it('returns just the base when no custom schema is supplied', () => {
    expect(effectiveSchemaFor('string', null)).toEqual({ type: 'string' });
  });

  it('intersects the base with a custom schema via allOf', () => {
    const custom = { maxLength: 10 };
    expect(effectiveSchemaFor('string', custom)).toEqual({
      allOf: [{ type: 'string' }, { maxLength: 10 }],
    });
  });

  it('a custom schema narrows what the base valueType alone would accept', () => {
    // valueType=string base accepts any string; the custom schema narrows to <=3 chars.
    const result = validateValue('string', 'this is too long', { schema: { maxLength: 3 } });
    expect(result.valid).toBe(false);
  });
});

describe('validateDefaultValue (S2 AC4 — unsatisfiable defaults never enter the catalog)', () => {
  it('accepts a default that satisfies its own schema', () => {
    const result = validateDefaultValue({
      valueType: 'enum',
      defaultValue: 'dark',
      enumValues: ['light', 'dark'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a default that does NOT satisfy its own schema', () => {
    const result = validateDefaultValue({
      valueType: 'enum',
      defaultValue: 'purple',
      enumValues: ['light', 'dark'],
    });
    expect(result.valid).toBe(false);
    expect(result.allowedValues).toEqual(['light', 'dark']);
  });

  it('rejects a default inconsistent with valueType regardless of a permissive custom schema', () => {
    // A number-typed key whose custom schema is a no-op object must still
    // reject a string default — the base derived from valueType is ALWAYS
    // intersected in, never overridden by the custom schema alone.
    const result = validateDefaultValue({
      valueType: 'number',
      defaultValue: 'not a number',
      schema: {},
    });
    expect(result.valid).toBe(false);
  });
});
