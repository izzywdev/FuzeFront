#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING gateway. Unlike the vitest suite this
 * speaks the real MCP SSE transport, so it is what proves a product's gateway
 * actually works before anyone flips `mcp.enabled` to true in that product's
 * .fuze/manifest.json.
 *
 *   MCP_PRODUCT=fuzeservice \
 *   MCP_UPSTREAM_BASE_URL=http://localhost:8080/v1 \
 *   MCP_OPENAPI_SPEC=../../contracts/openapi.yaml \
 *   MCP_TOOL_OVERRIDES=../../mcp/tools.overrides.yaml \
 *   PORT=8099 node dist/main.js &
 *
 *   node scripts/smoke.mjs http://127.0.0.1:8099
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8099';
const token = process.env.SMOKE_TOKEN ?? 'Bearer smoke-test-token';
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function connect(headers) {
  const transport = new SSEClientTransport(new URL(`${base}/sse`), {
    requestInit: { headers },
    eventSourceInit: {
      fetch: (u, init) => fetch(u, { ...init, headers: { ...init?.headers, ...headers } }),
    },
  });
  const client = new Client({ name: 'smoke', version: '1.0.0' }, { capabilities: {} });
  return client.connect(transport).then(() => client);
}

const client = await connect({ authorization: token });
const { tools } = await client.listTools();

check('MCP handshake over SSE', true);
check('tools enumerate', tools.length > 0, `${tools.length} tools`);

// Every tool advertising readOnlyHint must be bound to a safe HTTP method.
// This is the invariant that keeps an irreversible write from being reachable
// as a side effect of something that looks like a read.
const safe = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];
const liars = tools.filter(
  t => t.annotations?.readOnlyHint && !safe.includes(t._meta?.['fuze/method'])
);
check('no read-only tool is bound to an unsafe method', liars.length === 0, liars.map(t => t.name).join(', '));

// Irreversible tools must never be advertised as reads.
const destructive = tools.filter(t => t.annotations?.destructiveHint);
check(
  'every irreversible tool is also a write',
  destructive.every(t => !t.annotations.readOnlyHint),
  destructive.map(t => t.name).join(', ') || 'none declared'
);

await client.close();

// A call with no caller identity must be refused, and must not reach upstream.
const anon = await connect({});
const res = await anon.callTool({ name: tools.find(t => t.annotations?.readOnlyHint)?.name, arguments: {} });
check('call without caller identity fails closed', res.isError === true, String(res.content?.[0]?.text).slice(0, 80));
await anon.close();

console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
