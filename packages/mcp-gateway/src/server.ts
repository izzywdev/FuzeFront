/**
 * MCP server wiring + the remote SSE HTTP surface.
 *
 * Transport is the MCP HTTP+SSE pair:
 *   GET  /sse       -> opens the event stream, returns a sessionId
 *   POST /messages  -> client -> server JSON-RPC, correlated by sessionId
 *
 * The caller's HTTP headers are captured per session and replayed onto every
 * upstream call made in that session, which is what makes per-user authorization
 * work: the product API sees the user, not the gateway.
 */

import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildTools, type ToolDescriptor } from './spec.js';
import { callUpstream, MissingIdentityError, type CallerContext } from './upstream.js';
import type { GatewayConfig } from './config.js';

export interface Session {
  transport: SSEServerTransport;
  caller: CallerContext;
}

export function createMcpServer(config: GatewayConfig, tools: ToolDescriptor[], getCaller: () => CallerContext) {
  const server = new Server(
    { name: `${config.product}-mcp-gateway`, version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const byName = new Map(tools.map(t => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      // Non-standard but load-bearing: the classification travels with the tool
      // so a client can refuse to auto-approve irreversible calls.
      _meta: {
        'fuze/mutates': t.classification.mutates,
        'fuze/reversibility': t.classification.reversibility,
        'fuze/method': t.method.toUpperCase(),
        'fuze/path': t.path,
      },
      annotations: {
        readOnlyHint: !t.classification.mutates,
        destructiveHint: t.classification.reversibility === 'irreversible',
        idempotentHint: ['get', 'head', 'put', 'delete'].includes(t.method.toLowerCase()),
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const result = await callUpstream(tool, args, config.upstreamBaseUrl, getCaller());
      return {
        isError: !result.ok,
        content: [
          {
            type: 'text' as const,
            text:
              typeof result.body === 'string'
                ? result.body
                : JSON.stringify(result.body, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof MissingIdentityError
        ? err.message
        : `Upstream call failed: ${(err as Error).message}`;
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  });

  return server;
}

export function createHttpServer(config: GatewayConfig) {
  // Built once at boot. A classification error here means the process exits
  // before serving anything, which is the intended failure mode.
  const tools = buildTools(config.spec, config.overrides);

  const sessions = new Map<string, Session>();
  // The MCP SDK invokes tool handlers without the originating HTTP request, so
  // the active session's caller context is set immediately before dispatch.
  let activeCaller: CallerContext = { headers: {} };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', product: config.product, tools: tools.length }));
      return;
    }

    // Introspection endpoint: the tool manifest with its mutation classification.
    // Read-only and unauthenticated by design — it exposes the SHAPE of the API
    // (which the OpenAPI spec already publishes), never any data from it.
    if (req.method === 'GET' && url.pathname === '/tools.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            product: config.product,
            generatedFrom: config.spec.info?.title ?? 'openapi',
            tools: tools.map(t => ({
              name: t.name,
              method: t.method.toUpperCase(),
              path: t.path,
              mutates: t.classification.mutates,
              reversibility: t.classification.reversibility,
              reason: t.classification.reason,
              description: t.description,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      const caller: CallerContext = { headers: req.headers };
      const server = createMcpServer(config, tools, () => activeCaller);

      sessions.set(transport.sessionId, { transport, caller });
      res.on('close', () => sessions.delete(transport.sessionId));

      await server.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown or expired sessionId' }));
        return;
      }
      // Prefer the identity on THIS request; fall back to the one presented when
      // the stream was opened. Either way it is the caller's, never the gateway's.
      activeCaller = req.headers.authorization ? { headers: req.headers } : session.caller;
      await session.transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return { httpServer, tools };
}
