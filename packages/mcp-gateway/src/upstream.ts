/**
 * Upstream HTTP caller.
 *
 * AUTHZ CONTRACT — the part that must not be "simplified" later:
 *
 * The gateway forwards the CALLER'S identity to the product API and never
 * substitutes one of its own. There is deliberately no service-token option, no
 * `MCP_UPSTREAM_TOKEN`, and no fallback credential anywhere in this file. A
 * shared token would make every request look like the gateway rather than like
 * the user, which silently bypasses every per-user Permit check on the product
 * side — the gateway would become a confused deputy with the union of all
 * users' permissions.
 *
 * A call with no caller credential is refused here rather than sent onward
 * unauthenticated, so a missing token fails closed and visibly.
 */

import type { ToolDescriptor } from './spec.js';
import { getOwn, safeRecord } from './safety.js';

export class MissingIdentityError extends Error {}

export interface UpstreamResult {
  status: number;
  ok: boolean;
  body: unknown;
}

/** Headers we forward from the MCP caller to the product API. */
const FORWARDED_HEADERS = ['authorization', 'x-request-id', 'x-tenant-id', 'x-organization-id'];

export interface CallerContext {
  /** Raw headers from the MCP client's HTTP request. */
  headers: Record<string, string | string[] | undefined>;
}

export function extractForwardHeaders(ctx: CallerContext): Record<string, string> {
  const out = safeRecord<string>();
  for (const [k, v] of Object.entries(ctx.headers ?? {})) {
    const key = k.toLowerCase();
    if (!FORWARDED_HEADERS.includes(key)) continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/** Substitute {param} path segments and split args into query/header/body. */
export function buildRequest(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
  baseUrl: string
): { url: string; headers: Record<string, string>; body?: string } {
  let path = tool.path;
  const query = new URLSearchParams();
  // Null-prototype: keyed by spec-supplied header parameter names.
  const headers = safeRecord<string>();

  for (const p of tool.params) {
    // OWN-property read only. `args[p.name]` would resolve `constructor` to
    // Object.prototype.constructor and stringify a function into the URL;
    // `getOwn` returns undefined for anything the caller did not actually send.
    // buildTools already rejects prototype-keyed parameter names, so this is the
    // second of two independent guards rather than the only one.
    const raw = getOwn(args, p.name);
    if (raw === undefined || raw === null) {
      if (p.required) {
        throw new Error(`Missing required parameter "${p.name}" for tool "${tool.name}".`);
      }
      continue;
    }
    const value = String(raw);
    if (p.in === 'path') {
      path = path.replace(`{${p.name}}`, encodeURIComponent(value));
    } else if (p.in === 'query') {
      if (Array.isArray(raw)) raw.forEach(v => query.append(p.name, String(v)));
      else query.append(p.name, value);
    } else {
      headers[p.name] = value;
    }
  }

  const unresolved = path.match(/\{[^}]+\}/);
  if (unresolved) {
    throw new Error(`Unresolved path parameter ${unresolved[0]} for tool "${tool.name}".`);
  }

  const qs = query.toString();
  const url = `${baseUrl.replace(/\/+$/, '')}${path}${qs ? `?${qs}` : ''}`;

  let body: string | undefined;
  const bodyArg = getOwn(args, 'body');
  if (tool.bodySchema && bodyArg !== undefined) {
    body = JSON.stringify(bodyArg);
    headers['content-type'] = 'application/json';
  }

  return { url, headers, body };
}

export async function callUpstream(
  tool: ToolDescriptor,
  args: Record<string, unknown>,
  baseUrl: string,
  caller: CallerContext,
  fetchImpl: typeof fetch = fetch
): Promise<UpstreamResult> {
  const forwarded = extractForwardHeaders(caller);

  if (!forwarded.authorization) {
    // Fail closed. Never fall back to a gateway-owned credential.
    throw new MissingIdentityError(
      'No Authorization header on the MCP request. The gateway forwards the caller\'s ' +
        'identity to the product API and has no credential of its own, so this call ' +
        'cannot be made. Authenticate the MCP client and retry.'
    );
  }

  const { url, headers, body } = buildRequest(tool, args, baseUrl);

  const res = await fetchImpl(url, {
    method: tool.method.toUpperCase(),
    headers: { accept: 'application/json', ...headers, ...forwarded },
    ...(body !== undefined ? { body } : {}),
  });

  const text = await res.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON upstream response is returned as text */
    }
  }

  return { status: res.status, ok: res.ok, body: parsed };
}
