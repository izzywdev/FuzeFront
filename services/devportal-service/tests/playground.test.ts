// playground.test.ts — mockResponse() is pure spec-in/response-out logic
// (docs/planning/developers-portal.md §6's safety property: never a real
// network call) so it's tested directly, without a database.

import { mockResponse } from '../src/services/playground';
import type { SpecRecord } from '../src/services/registry';

function specWith(paths: Record<string, unknown>): SpecRecord {
  return {
    id: 'spec-1',
    repo: 'fuzefront',
    service: 'example-service',
    specPath: 'services/example-service/openapi.yaml',
    version: '1.0.0',
    fetchedAt: new Date().toISOString(),
    rawSpec: { openapi: '3.0.3', info: { title: 'Example', version: '1.0.0' }, paths },
  };
}

describe('mockResponse', () => {
  it('returns null for an unknown operationId', () => {
    const spec = specWith({});
    expect(mockResponse(spec, 'doesNotExist')).toBeNull();
  });

  it('returns the documented example for a 2xx response', () => {
    const spec = specWith({
      '/widgets': {
        get: {
          operationId: 'listWidgets',
          responses: {
            '200': {
              content: {
                'application/json': {
                  example: { items: [{ id: 'w1' }] },
                },
              },
            },
          },
        },
      },
    });

    const result = mockResponse(spec, 'listWidgets');
    expect(result).toEqual({ status: 200, body: { items: [{ id: 'w1' }] }, source: 'example' });
  });

  it('synthesizes a value from the schema when no example is present', () => {
    const spec = specWith({
      '/widgets/{id}': {
        get: {
          operationId: 'getWidget',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      count: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const result = mockResponse(spec, 'getWidget');
    expect(result?.source).toBe('schema-synthesized');
    expect(result?.status).toBe(200);
    expect(result?.body).toEqual({ id: 'string', count: 0 });
  });

  it('never returns a body that looks like it came from a real backend call', () => {
    const spec = specWith({
      '/widgets': {
        post: {
          operationId: 'createWidget',
          responses: { '201': {} },
        },
      },
    });

    const result = mockResponse(spec, 'createWidget');
    expect(result).toEqual({ status: 201, body: null, source: 'no-example-available' });
  });
});
