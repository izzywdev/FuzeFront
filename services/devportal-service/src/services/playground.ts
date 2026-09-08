// playground.ts — the sandboxed "Try it" proxy (docs/planning/developers-
// portal.md §6). The hard constraint: a developer must never reach a real
// production system through this path.
//
// MVP mock strategy: resolve the selected operation's response EXAMPLE
// straight from the spec itself (OpenAPI `examples`/`example`, falling back
// to a value synthesized from the response `schema`) and return that —
// zero network calls out of this service, so there is no target host to get
// wrong. This is deliberately narrower than the plan's full Prism-mock-
// server proposal (§6): it satisfies the same safety property (spec-only,
// no real backend) with far less surface, and is the natural place a
// dedicated Prism mocker slots in later without changing this function's
// contract (operationId in, {status, body} out).
//
// `x-fuzefront-sandbox-url` opt-in (§6, real sandbox URLs) is intentionally
// NOT implemented here — no family repo has opted in yet, and wiring an
// outbound HTTP call before there is a declared, reviewed target would be
// exactly the "silently hit something real" risk this whole section exists
// to prevent.

import { db } from '../db';
import type { SpecRecord } from './registry';

export interface PlaygroundRequest {
  operationId: string;
}

export interface PlaygroundResult {
  status: number;
  body: unknown;
  source: 'example' | 'schema-synthesized' | 'no-example-available';
}

function findOperation(
  spec: SpecRecord,
  operationId: string
): { method: string; path: string; operation: any } | null {
  const paths = (spec.rawSpec as any).paths ?? {};
  for (const [path, methods] of Object.entries<any>(paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      if (operation && operation.operationId === operationId) {
        return { method: method.toUpperCase(), path, operation };
      }
    }
  }
  return null;
}

function synthesizeFromSchema(schema: any): unknown {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries<any>(schema.properties ?? {})) {
        out[key] = synthesizeFromSchema(propSchema);
      }
      return out;
    }
    case 'array':
      return [synthesizeFromSchema(schema.items)];
    case 'string':
      return schema.enum?.[0] ?? 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

/** Picks the first documented 2xx response and returns its example (or a
 * schema-synthesized stand-in). Never performs a network call. */
export function mockResponse(spec: SpecRecord, operationId: string): PlaygroundResult | null {
  const found = findOperation(spec, operationId);
  if (!found) return null;

  const responses = found.operation.responses ?? {};
  const successCode = Object.keys(responses).find(code => /^2\d\d$/.test(code)) ?? Object.keys(responses)[0];
  if (!successCode) {
    return { status: 200, body: null, source: 'no-example-available' };
  }

  const content = responses[successCode]?.content?.['application/json'];
  if (content?.example !== undefined) {
    return { status: Number(successCode), body: content.example, source: 'example' };
  }
  if (content?.examples) {
    const first = Object.values<any>(content.examples)[0];
    if (first?.value !== undefined) {
      return { status: Number(successCode), body: first.value, source: 'example' };
    }
  }
  if (content?.schema) {
    return {
      status: Number(successCode),
      body: synthesizeFromSchema(content.schema),
      source: 'schema-synthesized',
    };
  }
  return { status: Number(successCode), body: null, source: 'no-example-available' };
}

/** §6 rate limiting / DevPortalPlayground:view_history — logs every call. */
export async function logCall(params: {
  userId: string;
  specId: string;
  operationId: string;
  method: string;
  path: string;
  responseStatus: number;
}): Promise<void> {
  await db('devportal_playground_calls').insert({
    user_id: params.userId,
    spec_id: params.specId,
    operation_id: params.operationId,
    method: params.method,
    path: params.path,
    response_status: params.responseStatus,
  });
}

const QUOTA_WINDOW_HOURS = 1;
const QUOTA_LIMIT_PER_WINDOW = 60;

/** Returns { used, limit, resetsAt } for the caller's current rolling window. */
export async function getQuota(userId: string): Promise<{ used: number; limit: number; windowHours: number }> {
  const since = new Date(Date.now() - QUOTA_WINDOW_HOURS * 60 * 60 * 1000);
  const row = await db('devportal_playground_calls')
    .where('user_id', userId)
    .where('called_at', '>=', since)
    .count<{ count: string }[]>({ count: '*' })
    .first();
  return {
    used: Number(row?.count ?? 0),
    limit: QUOTA_LIMIT_PER_WINDOW,
    windowHours: QUOTA_WINDOW_HOURS,
  };
}

export async function isOverQuota(userId: string): Promise<boolean> {
  const { used, limit } = await getQuota(userId);
  return used >= limit;
}

export async function listHistory(userId: string, limit = 50): Promise<any[]> {
  return db('devportal_playground_calls')
    .where('user_id', userId)
    .orderBy('called_at', 'desc')
    .limit(limit);
}
