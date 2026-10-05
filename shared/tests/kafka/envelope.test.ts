import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { EnvelopeV2Schema, parseEnvelope, envelopePartitionKey } from '../../src/kafka';

const ROOT = path.resolve(__dirname, '../../..');
const VECTOR_FILES = {
  valid: path.join(ROOT, 'packages/conformance-vectors/events/envelopes.valid.json'),
  invalid: path.join(ROOT, 'packages/conformance-vectors/events/envelopes.invalid.json'),
  dedupe: path.join(ROOT, 'packages/conformance-vectors/events/dedupe.json'),
  versionGuard: path.join(ROOT, 'packages/conformance-vectors/events/version-guard.json'),
} as const;
const vec = (k: keyof typeof VECTOR_FILES) => JSON.parse(fs.readFileSync(VECTOR_FILES[k], 'utf8'));
const schema = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'contracts/events/envelope.v2.schema.json'), 'utf8')
);

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateJson = ajv.compile(schema);

const valid: { name: string; envelope: unknown }[] = vec('valid').vectors;
const invalid: { name: string; why: string; envelope: unknown }[] =
  vec('invalid').vectors;

describe('envelope v2: Zod and JSON Schema agree on the conformance vectors', () => {
  test('vector files are non-vacuous and every invalid vector states why', () => {
    expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length).toBeGreaterThanOrEqual(20);
    for (const v of invalid) expect(v.why.length).toBeGreaterThan(10);
  });

  test.each(valid.map((v) => [v.name, v.envelope] as const))('valid: %s', (_n, envelope) => {
    expect(EnvelopeV2Schema.safeParse(envelope).success).toBe(true);
    expect(validateJson(envelope)).toBe(true);
    const r = parseEnvelope(envelope);
    expect(r.success).toBe(true);
  });

  test.each(invalid.map((v) => [v.name, v.envelope] as const))('invalid: %s', (_n, envelope) => {
    expect(EnvelopeV2Schema.safeParse(envelope).success).toBe(false);
    expect(validateJson(envelope)).toBe(false);
    expect(parseEnvelope(envelope).success).toBe(false);
  });

  test('JSON Schema required list equals Zod required keys', () => {
    const shape = Object.keys(EnvelopeV2Schema.shape).sort();
    expect(Object.keys(schema.properties).sort()).toEqual(shape);
    const optional = shape.filter((k) => (EnvelopeV2Schema.shape as any)[k].isOptional());
    expect([...schema.required].sort()).toEqual(shape.filter((k) => !optional.includes(k)).sort());
  });
});

describe('parseEnvelope', () => {
  const v1 = {
    version: '1.0',
    topic: 'identity.org.created',
    correlationId: 'c-1',
    occurredAt: '2026-10-05T12:00:00.000Z',
    payload: { id: 'x' },
  };

  test('v1 normalizes with aggregate fields absent', () => {
    const r = parseEnvelope(v1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.envelope).toEqual({
      envelopeVersion: 1,
      topic: 'identity.org.created',
      schemaVersion: '1.0',
      correlationId: 'c-1',
      occurredAt: '2026-10-05T12:00:00.000Z',
      payload: { id: 'x' },
    });
    expect(r.envelope.eventId).toBeUndefined();
    expect(r.envelope.aggregateVersion).toBeUndefined();
  });

  test('v2 normalizes with all fields and numeric schemaVersion stringified', () => {
    const e = valid[1].envelope as any;
    const r = parseEnvelope(e);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.envelope.envelopeVersion).toBe(2);
    expect(r.envelope.eventId).toBe(e.eventId);
    expect(r.envelope.causationId).toBe(e.causationId);
    expect(r.envelope.schemaVersion).toBe('1');
    expect(r.envelope.aggregateVersion).toBe(e.aggregateVersion);
  });

  test('a v1 envelope with a stray v2 field is judged as v2 and rejected', () => {
    expect(parseEnvelope({ ...v1, eventId: 'evt_01h455vb4pex5vsknk084sn02q' }).success).toBe(false);
    expect(parseEnvelope({ ...v1, aggregateVersion: 1 }).success).toBe(false);
  });

  test('garbage never throws', () => {
    for (const x of [null, undefined, 42, 'x', [], {}]) expect(parseEnvelope(x).success).toBe(false);
  });

  test('partition key is aggregateId', () => {
    const e = valid[0].envelope as any;
    expect(envelopePartitionKey(e)).toBe(e.aggregateId);
  });
});

describe('consumer vectors are well-formed (consumed by TS and Python suites)', () => {
  test('dedupe.json', () => {
    const d = vec('dedupe');
    for (const c of d.cases) {
      expect(c.expectedOutcomes).toHaveLength(c.deliveries.length);
      const seen = new Set<string>();
      const effects: Record<string, number> = {};
      c.deliveries.forEach((x: any, i: number) => {
        const k = `${x.consumer}|${x.eventId}`;
        const out = seen.has(k) ? 'duplicate' : 'applied';
        seen.add(k);
        if (out === 'applied') effects[x.consumer] = (effects[x.consumer] ?? 0) + 1;
        expect(out).toBe(c.expectedOutcomes[i]);
      });
      expect(effects).toEqual(c.expectedEffects);
    }
  });

  test('version-guard.json reference model reproduces every expectation', () => {
    const g = vec('versionGuard');
    for (const c of g.cases) {
      const state: Record<string, { version: number; deleted: boolean; data: unknown }> = {};
      const outcomes = c.events.map((e: any) => {
        const cur = state[e.aggregateId]?.version ?? 0;
        if (e.aggregateVersion <= cur) return 'ignored';
        state[e.aggregateId] =
          e.kind === 'deleted'
            ? { version: e.aggregateVersion, deleted: true, data: null }
            : { version: e.aggregateVersion, deleted: false, data: e.data };
        return 'applied';
      });
      expect({ case: c.name, outcomes }).toEqual({ case: c.name, outcomes: c.expectedOutcomes });
      expect({ case: c.name, state }).toEqual({ case: c.name, state: c.expectedFinalState });
    }
  });
});
