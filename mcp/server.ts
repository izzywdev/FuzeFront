/**
 * FuzeFront MCP server — SCAFFOLD (first-run skeleton).
 *
 * MCP is how an LLM session queries and operates on this repo's objects and
 * data directly (the sibling of the A2A surface, which is how another *agent*
 * asks this repo for an outcome). This file is the minimal, dependency-free
 * stdio server declared by `.fuze/manifest.json` -> `mcp.servers[].entry`.
 *
 * STATUS: it starts, completes the MCP handshake, and advertises the tools in
 * `tools.json` — which is intentionally EMPTY. The server is `enabled: false`
 * in the manifest and MUST stay so until a real, working tool is wired: an
 * advertised server that errors on every call is worse than one that is off.
 *
 * OWNERSHIP: mcp-maintainer owns this wiring (transport, handshake, the
 * tools.json <-> tools/list contract). It does NOT author tool BEHAVIOUR —
 * which table a tool reads, its business rules. Those, and the schemas in
 * tools.json, are backend-engineer's. See README.md for the intended tool
 * inventory (app-registry reads, org/user/portal context reads) and the
 * read/write + sensitive-exposure classification each must carry.
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 (one JSON object per line).
 * Dependency-free by design so it starts and is verifiable without an install
 * in this deploy-on-push repo. When real tools land, backend-engineer may swap
 * this for @modelcontextprotocol/sdk without changing the manifest contract.
 *
 * Run:  node --experimental-strip-types mcp/server.ts
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

// The MCP protocol revision this scaffold speaks. Keep in step with the family
// MCP contract; bump here (and re-verify the handshake) when the standard moves.
const PROTOCOL_VERSION = '2025-06-18'

const HERE = dirname(fileURLToPath(import.meta.url))

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  // FuzeFront extension: read/write split. Not part of MCP's tools/list wire
  // shape, so it is stripped before advertising (see toWireTool).
  mutates?: boolean
}

function loadTools(): McpTool[] {
  try {
    const raw = readFileSync(join(HERE, 'tools.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as McpTool[]) : []
  } catch {
    // A missing/broken manifest means "no tools", never a crash on boot.
    return []
  }
}

// Advertise only MCP's expected fields; `mutates` is an internal classification.
function toWireTool(t: McpTool): Record<string, unknown> {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object' },
  }
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function result(id: JsonRpcRequest['id'], value: unknown): void {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id: JsonRpcRequest['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function handle(req: JsonRpcRequest): void {
  switch (req.method) {
    case 'initialize':
      result(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fuzefront-platform', version: '0.0.0' },
      })
      return

    // Notifications carry no id and get no response.
    case 'notifications/initialized':
    case 'initialized':
      return

    case 'ping':
      result(req.id, {})
      return

    case 'tools/list':
      result(req.id, { tools: loadTools().map(toWireTool) })
      return

    case 'tools/call':
      // No tool is implemented in the scaffold; refuse honestly rather than
      // pretending. -32601 = Method not found (JSON-RPC).
      error(
        req.id,
        -32601,
        'No MCP tools are implemented yet. This server is a scaffold (enabled:false). See mcp/README.md.'
      )
      return

    default:
      if (req.id === undefined || req.id === null) return // unknown notification
      error(req.id, -32601, `Method not found: ${req.method}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  const text = line.trim()
  if (!text) return
  let req: JsonRpcRequest
  try {
    req = JSON.parse(text)
  } catch {
    error(null, -32700, 'Parse error')
    return
  }
  try {
    handle(req)
  } catch (e) {
    error(req.id ?? null, -32603, `Internal error: ${(e as Error).message}`)
  }
})
