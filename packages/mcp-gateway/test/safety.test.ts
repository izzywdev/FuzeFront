/**
 * Prototype-pollution / property-injection regression tests.
 *
 * These drive the REAL code paths with hostile keys rather than unit-testing the
 * guards in isolation, because the guards are only worth anything if they sit on
 * the path a malicious OpenAPI document or a model-generated argument actually
 * takes. Each test also asserts Object.prototype is untouched afterwards — a fix
 * that stops throwing but starts polluting would otherwise pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildTools, type OpenApiDoc } from '../src/spec.js';
import { buildRequest, extractForwardHeaders, callUpstream } from '../src/upstream.js';
import { getOwn, safeRecord, isForbiddenKey } from '../src/safety.js';

const BASE = 'http://upstream.local/v1';

// Anything a polluting payload might have written.
const CANARIES = ['polluted', 'isAdmin', 'x-injected'] as const;

function expectCleanPrototype() {
  for (const key of CANARIES) {
    expect(({} as Record<string, unknown>)[key], `Object.prototype.${key}`).toBeUndefined();
  }
}

afterEach(() => {
  expectCleanPrototype();
  for (const key of CANARIES) delete (Object.prototype as Record<string, unknown>)[key];
});

describe('safety helpers', () => {
  it('identifies the prototype-resolving keys', () => {
    expect(isForbiddenKey('__proto__')).toBe(true);
    expect(isForbiddenKey('constructor')).toBe(true);
    expect(isForbiddenKey('prototype')).toBe(true);
    expect(isForbiddenKey('ticketId')).toBe(false);
  });

  it('getOwn does not read through the prototype chain', () => {
    // A plain object "has" a constructor via its prototype; getOwn must not see it.
    expect(getOwn({}, 'constructor')).toBeUndefined();
    expect(getOwn({}, 'toString')).toBeUndefined();
    expect(getOwn({ ticketId: 'T-1' }, 'ticketId')).toBe('T-1');
  });

  it('safeRecord stores __proto__ as ordinary data instead of reparenting', () => {
    const r = safeRecord();
    r['__proto__'] = { polluted: true };
    expect(Object.getPrototypeOf(r)).toBeNull();
    expectCleanPrototype();
  });
});

describe('spec parsing rejects hostile documents', () => {
  it('refuses a $ref that points through __proto__', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            parameters: [{ $ref: '#/__proto__/polluted' }],
          },
        },
      },
    };
    expect(() => buildTools(doc)).toThrow(/prototype/i);
  });

  it('refuses a $ref that points through constructor/prototype', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/a': { get: { operationId: 'a', parameters: [{ $ref: '#/components/constructor/x' }] } },
      },
      // Present so traversal genuinely reaches the `constructor` segment; without
      // it the pointer would die on a missing key and the test would pass for
      // the wrong reason.
      components: { parameters: {} },
    };
    expect(() => buildTools(doc)).toThrow(/prototype/i);
  });

  it('refuses a hostile segment even when an earlier segment does not exist', () => {
    // `absent` is missing, so a lazily-checked guard would never reach
    // `__proto__` and would wrongly accept the pointer.
    const doc: OpenApiDoc = {
      paths: { '/a': { get: { operationId: 'a', parameters: [{ $ref: '#/absent/__proto__' }] } } },
    };
    expect(() => buildTools(doc)).toThrow(/prototype/i);
  });

  it('refuses a parameter literally named __proto__', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            parameters: [{ name: '__proto__', in: 'query', schema: { polluted: true } }],
          },
        },
      },
    };
    expect(() => buildTools(doc)).toThrow(/prototype/i);
  });

  it('refuses an operationId that resolves to a prototype key', () => {
    const doc: OpenApiDoc = { paths: { '/a': { get: { operationId: 'constructor' } } } };
    expect(() => buildTools(doc)).toThrow(/prototype/i);
  });

  it('builds a null-prototype input schema so a schema key cannot pollute', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            parameters: [{ name: 'ok', in: 'query', schema: { type: 'string' } }],
          },
        },
      },
    };
    const [tool] = buildTools(doc);
    expect(Object.getPrototypeOf(tool.inputSchema.properties)).toBeNull();
  });
});

describe('argument handling resists property injection', () => {
  const doc: OpenApiDoc = {
    paths: {
      '/tickets/{ticketId}': {
        get: {
          operationId: 'getTicket',
          parameters: [
            { name: 'ticketId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'expand', in: 'query', schema: { type: 'string' } },
          ],
        },
      },
    },
  };
  const tool = buildTools(doc)[0];

  it('ignores inherited properties on the arguments object', () => {
    // A model-supplied argument bag whose PROTOTYPE carries `expand`. Reading it
    // with plain bracket notation would smuggle an attacker-chosen query value
    // into the upstream URL; getOwn must not see it.
    const hostile = Object.create({ expand: 'injected-via-prototype' }) as Record<string, unknown>;
    hostile.ticketId = 'T-1';

    const { url } = buildRequest(tool, hostile, BASE);
    expect(url).toBe(`${BASE}/tickets/T-1`);
    expect(url).not.toContain('injected-via-prototype');
  });

  it('does not stringify Object.prototype.constructor into the request', () => {
    // If a spec ever slipped a `constructor` parameter past the build-time guard,
    // the RUNTIME read must still yield nothing rather than a function source.
    // Plain `args['constructor']` would return Object.prototype.constructor and
    // splice `function Object() { [native code] }` into the query string.
    const rogue = {
      ...tool,
      params: [
        ...tool.params,
        { name: 'constructor', in: 'query' as const, required: false, schema: {} },
      ],
    };
    const { url } = buildRequest(rogue, { ticketId: 'T-1' }, BASE);
    expect(url).toBe(`${BASE}/tickets/T-1`);
    expect(url).not.toMatch(/function|native code/i);
  });

  it('a __proto__ key in the request body is serialised, never applied', () => {
    const bodyTool = buildTools({
      paths: {
        '/t': {
          post: {
            operationId: 'create',
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
    })[0];

    const { body } = buildRequest(bodyTool, { body: JSON.parse('{"__proto__":{"polluted":true}}') }, BASE);
    expect(typeof body).toBe('string');
    expectCleanPrototype();
  });

  it('forwards headers into a null-prototype object', () => {
    const out = extractForwardHeaders({ headers: { authorization: 'Bearer t' } });
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out.authorization).toBe('Bearer t');
  });

  it('a hostile upstream JSON response cannot pollute the prototype', async () => {
    // The gateway JSON.parses whatever the product API returns. JSON.parse does
    // not apply __proto__, but this pins that we never hand that payload to a
    // merge/assign that would.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"__proto__":{"polluted":true},"ok":1}', { status: 200 })
    );
    const res = await callUpstream(
      tool,
      { ticketId: 'T-1' },
      BASE,
      { headers: { authorization: 'Bearer t' } },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(true);
    expectCleanPrototype();
  });
});
