#!/usr/bin/env node
/**
 * Entry point. One process = one product's MCP gateway.
 */
import { loadConfig } from './config.js';
import { createHttpServer } from './server.js';

function main() {
  const config = loadConfig();
  const { httpServer, tools } = createHttpServer(config);

  const mutating = tools.filter(t => t.classification.mutates);
  const irreversible = tools.filter(t => t.classification.reversibility === 'irreversible');

  httpServer.listen(config.port, () => {
    console.log(
      `[mcp-gateway] product=${config.product} upstream=${config.upstreamBaseUrl} ` +
        `port=${config.port} tools=${tools.length} ` +
        `(${tools.length - mutating.length} read-only, ${mutating.length} write, ` +
        `${irreversible.length} irreversible)`
    );
    // Descriptions can be degraded (no cache mounted, or the mounted cache no
    // longer matches this spec/overrides revision) independently of every
    // other boot fact above — log which mode was actually used so a degraded
    // boot is never silently indistinguishable from a good one.
    const { mode } = config.descriptions;
    if (mode === 'llm-cache') {
      console.log(
        `[mcp-gateway] descriptions: llm-cache (${Object.keys(config.descriptions.descriptions).length} tools) — ` +
          `hash-verified match of the mounted spec/overrides`
      );
    } else if (mode === 'fallback-stale-cache') {
      console.log(
        '[mcp-gateway] descriptions: FALLBACK — mounted cache does not match this spec/overrides ' +
          '(regenerate it); serving spec-derived descriptions instead'
      );
    } else {
      console.log(
        '[mcp-gateway] descriptions: FALLBACK — no MCP_DESCRIPTIONS_CACHE mounted; serving spec-derived descriptions'
      );
    }
    for (const t of irreversible) {
      console.log(`[mcp-gateway] IRREVERSIBLE: ${t.name} -> ${t.method.toUpperCase()} ${t.path}`);
    }
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => httpServer.close(() => process.exit(0)));
  }
}

try {
  main();
} catch (err) {
  // Boot-time failure (bad spec, bad override, banned service token) must kill
  // the pod loudly rather than serve a mis-declared tool surface.
  console.error(`[mcp-gateway] FATAL: ${(err as Error).message}`);
  process.exit(1);
}
