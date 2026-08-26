/**
 * Configuration. Everything that makes this pod "the FuzeService gateway"
 * rather than "the FuzeSales gateway" arrives here, at runtime, from env and
 * mounted files. Nothing product-specific is baked into the image — one image,
 * one pod per product.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { Overrides } from './classify.js';
import type { OpenApiDoc } from './spec.js';
import { loadDescriptionCacheFile, resolveDescriptions, type ResolvedDescriptions } from './descriptions.js';

export interface GatewayConfig {
  /** Product this pod serves, e.g. "fuzeservice". Used as the MCP server name. */
  product: string;
  /** Base URL of the product's REST API, in-cluster. */
  upstreamBaseUrl: string;
  /** Parsed OpenAPI document. */
  spec: OpenApiDoc;
  /** Per-product mutation overrides. */
  overrides: Overrides;
  port: number;
  /**
   * Build-time LLM-generated tool descriptions, resolved against a
   * hash of the spec/overrides this pod actually loaded. `mode` tells the
   * caller (main.ts) whether the cache was usable so a degraded boot is
   * logged, never silently indistinguishable from a good one.
   */
  descriptions: ResolvedDescriptions;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`${name} is required. This gateway is configured per product at runtime.`);
  }
  return v.trim();
}

function parseDocument(path: string, raw: string): OpenApiDoc {
  const doc = (path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as OpenApiDoc;
  if (!doc || typeof doc !== 'object' || !doc.paths) {
    throw new Error(`${path} does not look like an OpenAPI document (no "paths").`);
  }
  return doc;
}

export function loadDocument(path: string): OpenApiDoc {
  return parseDocument(path, readFileSync(path, 'utf8'));
}

function parseOverrides(path: string, raw: string): Overrides {
  const parsed = (path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as
    | { tools?: Overrides }
    | Overrides;
  const tools = (parsed as { tools?: Overrides }).tools ?? (parsed as Overrides);
  return tools ?? {};
}

export function loadOverrides(path: string | undefined): Overrides {
  if (!path) return {};
  return parseOverrides(path, readFileSync(path, 'utf8'));
}

export function loadConfig(): GatewayConfig {
  // Guard against the failure this whole design exists to prevent: someone
  // "fixing" auth by giving the gateway its own credential.
  for (const banned of ['MCP_UPSTREAM_TOKEN', 'MCP_SERVICE_TOKEN', 'MCP_API_KEY']) {
    if (process.env[banned]) {
      throw new Error(
        `${banned} is set. The gateway forwards the caller's identity and must never hold a ` +
          `credential of its own — a shared token bypasses every per-user authorization check ` +
          `on the product API. Remove it.`
      );
    }
  }

  const specPath = required('MCP_OPENAPI_SPEC');
  const specRaw = readFileSync(specPath, 'utf8');
  const overridesPath = process.env.MCP_TOOL_OVERRIDES;
  const overridesRaw = overridesPath ? readFileSync(overridesPath, 'utf8') : '';

  // The cache is OPTIONAL (MCP_DESCRIPTIONS_CACHE unset -> resolveDescriptions
  // reports fallback-no-cache) and its hash is checked against these SAME raw
  // bytes, so a cache generated for a different spec/overrides revision is
  // detected as stale rather than silently applied to the wrong operations.
  const descriptionCache = loadDescriptionCacheFile(process.env.MCP_DESCRIPTIONS_CACHE);
  const descriptions = resolveDescriptions(descriptionCache, specRaw, overridesRaw);

  return {
    product: required('MCP_PRODUCT'),
    upstreamBaseUrl: required('MCP_UPSTREAM_BASE_URL'),
    spec: parseDocument(specPath, specRaw),
    overrides: overridesPath ? parseOverrides(overridesPath, overridesRaw) : {},
    port: Number(process.env.PORT ?? 8081),
    descriptions,
  };
}
