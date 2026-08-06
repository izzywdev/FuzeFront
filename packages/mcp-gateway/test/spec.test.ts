import { describe, it, expect } from 'vitest';
import { buildTools, toolNameFor, type OpenApiDoc } from '../src/spec.js';

const doc: OpenApiDoc = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets',
        summary: 'List tickets',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { $ref: '#/components/parameters/PageSize' },
        ],
      },
      post: {
        operationId: 'createTicket',
        summary: 'Create a ticket',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
        },
      },
    },
    '/tickets/{ticketId}': {
      parameters: [{ name: 'ticketId', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getTicket', summary: 'Get a ticket' },
      patch: { operationId: 'updateTicket', summary: 'Update a ticket' },
    },
    '/approvals/{approvalId}/decision': {
      post: {
        operationId: 'decideApproval',
        summary: 'Record an approval decision',
        parameters: [{ name: 'approvalId', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
  },
  components: {
    parameters: { PageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer' } } },
    schemas: { Ticket: { type: 'object', properties: { subject: { type: 'string' } } } },
  },
};

describe('toolNameFor', () => {
  it('prefers operationId', () => {
    expect(toolNameFor('listTickets', 'get', '/tickets')).toBe('listTickets');
  });
  it('falls back to a method_path slug', () => {
    expect(toolNameFor(undefined, 'get', '/tickets/{ticketId}')).toBe('get_tickets_by_ticketId');
  });
});

describe('buildTools', () => {
  const tools = buildTools(doc);
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));

  it('emits one tool per operation', () => {
    expect(tools).toHaveLength(5);
  });

  it('resolves local $ref parameters', () => {
    const list = byName.listTickets;
    expect(list.params.map(p => p.name).sort()).toEqual(['pageSize', 'status']);
  });

  it('inherits path-level parameters into every operation', () => {
    expect(byName.getTicket.params.map(p => p.name)).toEqual(['ticketId']);
    expect(byName.updateTicket.params.map(p => p.name)).toEqual(['ticketId']);
  });

  it('resolves the request body schema and marks it required', () => {
    const create = byName.createTicket;
    expect(create.bodyRequired).toBe(true);
    expect(create.bodySchema).toMatchObject({ type: 'object' });
    expect((create.inputSchema as any).required).toContain('body');
  });

  it('classifies reads and writes from the method', () => {
    expect(byName.listTickets.classification.mutates).toBe(false);
    expect(byName.createTicket.classification.mutates).toBe(true);
    expect(byName.updateTicket.classification.mutates).toBe(true);
  });

  it('surfaces the safety class in the description the model reads', () => {
    expect(byName.listTickets.description).toMatch(/^\[READ-ONLY\]/);
    expect(byName.createTicket.description).toMatch(/^\[WRITE\]/);
  });

  it('honours an irreversible override and labels it in the description', () => {
    const withOverride = buildTools(doc, {
      decideApproval: {
        reversibility: 'irreversible',
        reason: 'An approval decision is irreversible from the requester side',
      },
    });
    const decide = withOverride.find(t => t.name === 'decideApproval')!;
    expect(decide.classification.mutates).toBe(true);
    expect(decide.classification.reversibility).toBe('irreversible');
    expect(decide.description).toMatch(/IRREVERSIBLE/);
  });

  it('refuses to build when an override would expose an irreversible op as a read', () => {
    expect(() =>
      buildTools(doc, { decideApproval: { mutates: false, reversibility: 'irreversible' } })
    ).toThrow(/irreversible/i);
  });

  it('rejects duplicate tool names', () => {
    const dup: OpenApiDoc = {
      paths: {
        '/a': { get: { operationId: 'same' } },
        '/b': { get: { operationId: 'same' } },
      },
    };
    expect(() => buildTools(dup)).toThrow(/Duplicate tool name/);
  });

  it('rejects remote $refs rather than fetching them at boot', () => {
    const remote: OpenApiDoc = {
      paths: { '/a': { get: { operationId: 'a', parameters: [{ $ref: 'https://x/y#/z' }] } } },
    };
    expect(() => buildTools(remote)).toThrow(/Remote \$ref/);
  });
});
