/**
 * Build-time LLM-generated tool descriptions — the cache the gateway READS
 * at boot, and never anything it calls an LLM to produce itself.
 *
 * WHY BUILD TIME, NOT REQUEST TIME: a gateway pod answering `tools/list` is on
 * the hot path for every MCP client that connects. Calling an LLM there would
 * add latency, cost, and a brand-new failure mode (the LLM gateway being down)
 * to something that today is a pure, instant, in-memory computation. So
 * generation happens OFFLINE (scripts/generate-descriptions.mjs, driven by
 * `npm run generate:descriptions`, or an equivalent CI step), keyed by a hash
 * of the exact spec + overrides text it was generated from, and the result is
 * a small JSON artifact this module loads synchronously at boot — no network
 * call, no LLM dependency, on the pod's startup path.
 *
 * WHAT THIS MODULE DOES NOT DO: it never decides `mutates` or `reversibility`.
 * Those stay 100% mechanical, derived in classify.ts from the HTTP method and
 * (optionally) a per-product overrides file — see that file's docstring for
 * why that has to stay true. This module only ever supplies PROSE, merged
 * into the tool description in spec.ts strictly after the classification (and
 * its `${safety}` prefix) has already been computed from the untouched
 * mechanical path. There is no code path here that can reach `classify()` or
 * mutate a `Classification` value.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface DescriptionCacheFile {
  /** sha256 (hex) of the raw OpenAPI document text the cache was generated from. */
  specHash: string;
  /** sha256 (hex) of the raw overrides file text (hash of '' if there was none). */
  overridesHash: string;
  /** LiteLLM-routed model that generated the prose, e.g. "gpt-4o-mini". Informational only. */
  model: string;
  generatedAt: string;
  /**
   * toolName -> generated prose. PROSE ONLY. Never a safety/mutates claim —
   * the generator (src/llm.ts `sanitizeGeneratedProse`) strips safety words on
   * the way out, and even an unsanitised string reaching here still has no
   * power over classification: nothing in spec.ts reads this map for
   * anything but the tool's descriptive sentence.
   */
  descriptions: Record<string, string>;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Type-guard-shaped parse: throws on a file that exists but isn't a cache. */
export function parseDescriptionCacheFile(raw: string, path: string): DescriptionCacheFile {
  const parsed = JSON.parse(raw) as Partial<DescriptionCacheFile>;
  if (
    typeof parsed.specHash !== 'string' ||
    typeof parsed.overridesHash !== 'string' ||
    typeof parsed.descriptions !== 'object' ||
    parsed.descriptions === null ||
    Array.isArray(parsed.descriptions)
  ) {
    throw new Error(
      `${path} does not look like a description cache (needs specHash, overridesHash, descriptions).`
    );
  }
  return parsed as DescriptionCacheFile;
}

/**
 * Load the mounted cache file, if the env var pointing at one is set. Absence
 * is not an error — an unconfigured cache is the same as a stale one from the
 * gateway's point of view: it falls back to the spec-derived description.
 */
export function loadDescriptionCacheFile(path: string | undefined): DescriptionCacheFile | undefined {
  if (!path) return undefined;
  if (!existsSync(path)) return undefined;
  return parseDescriptionCacheFile(readFileSync(path, 'utf8'), path);
}

export type DescriptionMode = 'llm-cache' | 'fallback-no-cache' | 'fallback-stale-cache';

export interface ResolvedDescriptions {
  mode: DescriptionMode;
  /** Empty unless mode === 'llm-cache'. */
  descriptions: Record<string, string>;
}

/**
 * Decide whether the mounted cache is USABLE for this boot: present AND its
 * specHash/overridesHash match the spec/overrides this pod actually loaded.
 *
 * A stale or absent cache is NOT a boot failure — the gateway must still
 * start and serve the mechanical, spec-derived description. It IS reported
 * honestly (the caller logs `mode`) so a degraded boot is never silently
 * indistinguishable from a good one.
 */
export function resolveDescriptions(
  cache: DescriptionCacheFile | undefined,
  specRaw: string,
  overridesRaw: string
): ResolvedDescriptions {
  if (!cache) {
    return { mode: 'fallback-no-cache', descriptions: {} };
  }
  const specHash = hashText(specRaw);
  const overridesHash = hashText(overridesRaw);
  if (cache.specHash !== specHash || cache.overridesHash !== overridesHash) {
    return { mode: 'fallback-stale-cache', descriptions: {} };
  }
  return { mode: 'llm-cache', descriptions: cache.descriptions };
}
