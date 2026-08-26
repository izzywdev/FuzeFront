#!/usr/bin/env node
/**
 * BUILD-TIME description generation. This is the ONLY place in this package
 * that calls an LLM — never the gateway's request-serving path (config.ts /
 * server.ts). Run it offline (locally, or as a CI/build step) whenever a
 * product's spec or overrides file changes, and commit the resulting cache
 * file alongside them (the same pattern this repo already uses for
 * deploy/helm/fuzefront/files/mcp-tools.overrides.yaml).
 *
 * Requires the package to be BUILT first (`npm run build`), since this reads
 * from dist/ rather than duplicating the mechanical spec/classification logic
 * — the whole point of that logic living in one place (classify.ts) is that
 * nothing else, including this script, re-derives it.
 *
 * Usage:
 *   npm run build
 *   LITELLM_FUZE_KEY=... [FUZE_LLM_BASE_URL=...] [MCP_DESCRIPTIONS_MODEL=...] \
 *     node scripts/generate-descriptions.mjs \
 *       --spec ../../services/app-registry-service/openapi.yaml \
 *       --overrides ../../deploy/helm/fuzefront/files/mcp-tools.overrides.yaml \
 *       --out ../../deploy/helm/fuzefront/files/mcp-tool-descriptions.cache.json
 *
 * INCREMENTAL: if --out already exists and its specHash/overridesHash still
 * match the current spec/overrides, existing per-tool descriptions are REUSED
 * rather than re-generated — this only ever calls the LLM for a tool whose
 * spec/overrides content actually changed since the last run (or is new).
 *
 * DEGRADE HONESTLY: with no LITELLM_FUZE_KEY, or if the gateway is
 * unreachable, this exits non-zero and writes NOTHING — it never produces a
 * cache file that silently claims LLM prose it doesn't have. The gateway
 * itself is unaffected either way: no cache file (or a stale one) is a normal,
 * logged, spec-derived-fallback boot, not an error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { buildTools } from '../dist/spec.js';
import { loadOverrides } from '../dist/config.js';
import { hashText, loadDescriptionCacheFile } from '../dist/descriptions.js';
import { resolveLlmGatewayConfig, describeOperation } from '../dist/llm.js';

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function usage(msg) {
  if (msg) console.error(`[generate-descriptions] ${msg}`);
  console.error(
    'Usage: node scripts/generate-descriptions.mjs --spec <openapi.yaml> [--overrides <overrides.yaml>] --out <descriptions.cache.json>'
  );
  process.exit(2);
}

async function main() {
  const specPath = argVal('--spec');
  const overridesPath = argVal('--overrides');
  const outPath = argVal('--out');
  if (!specPath || !outPath) usage();

  const specRaw = readFileSync(specPath, 'utf8');
  const doc = specPath.endsWith('.json') ? JSON.parse(specRaw) : parseYaml(specRaw);
  const overridesRaw = overridesPath ? readFileSync(overridesPath, 'utf8') : '';
  const overrides = overridesPath ? loadOverrides(overridesPath) : {};

  // Mechanical pass ONLY — classification + params + spec-derived summary.
  // No LLM involved yet; this is exactly what the gateway itself would build.
  const tools = buildTools(doc, overrides);

  const specHash = hashText(specRaw);
  const overridesHash = hashText(overridesRaw);

  let reusable = {};
  if (existsSync(outPath)) {
    const existing = loadDescriptionCacheFile(outPath);
    if (existing && existing.specHash === specHash && existing.overridesHash === overridesHash) {
      reusable = existing.descriptions;
    }
  }

  const toGenerate = tools.filter(t => !reusable[t.name]);

  if (toGenerate.length === 0) {
    console.log(
      `[generate-descriptions] ${outPath} is already current for this spec+overrides revision ` +
        `(${tools.length} tools, all reused). Nothing to do.`
    );
    return;
  }

  const llmConfig = resolveLlmGatewayConfig();
  if (!llmConfig) {
    console.error(
      '[generate-descriptions] LITELLM_FUZE_KEY is not set — cannot generate. Nothing written. ' +
        `(${toGenerate.length} of ${tools.length} tools need generation; ${Object.keys(reusable).length} would have been reused.)`
    );
    process.exit(1);
  }

  console.log(
    `[generate-descriptions] gateway=${llmConfig.baseUrl} model=${llmConfig.model} ` +
      `generating ${toGenerate.length} of ${tools.length} tools (${Object.keys(reusable).length} reused unchanged)...`
  );

  const descriptions = { ...reusable };
  let failed = 0;
  for (const tool of toGenerate) {
    try {
      descriptions[tool.name] = await describeOperation(llmConfig, {
        toolName: tool.name,
        method: tool.method,
        path: tool.path,
        mutates: tool.classification.mutates,
        reversibility: tool.classification.reversibility,
        specSummary: tool.specSummary,
        specDescription: tool.specDescription,
      });
      console.log(`[generate-descriptions] OK   ${tool.name}`);
    } catch (err) {
      failed++;
      console.error(`[generate-descriptions] FAIL ${tool.name}: ${err.message}`);
    }
  }

  if (failed > 0) {
    console.error(
      `[generate-descriptions] ${failed} of ${toGenerate.length} generations failed — nothing written. ` +
        'Fix the failures (or the gateway reachability) and re-run; a partial cache would silently mix ' +
        'generations from two different runs under one hash.'
    );
    process.exit(1);
  }

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        specHash,
        overridesHash,
        model: llmConfig.model,
        generatedAt: new Date().toISOString(),
        descriptions,
      },
      null,
      2
    ) + '\n'
  );

  console.log(
    `[generate-descriptions] wrote ${outPath}: ${toGenerate.length} generated, ` +
      `${Object.keys(reusable).length} reused, ${tools.length} total tools.`
  );
}

main().catch(err => {
  console.error(`[generate-descriptions] FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
