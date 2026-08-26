import { describe, it, expect } from 'vitest';
import {
  hashText,
  parseDescriptionCacheFile,
  resolveDescriptions,
  type DescriptionCacheFile,
} from '../src/descriptions.js';

const SPEC = 'openapi: 3.1.0\npaths: {}\n';
const OVERRIDES = 'tools: {}\n';

function cacheFor(specRaw: string, overridesRaw: string, descriptions: Record<string, string> = {}): DescriptionCacheFile {
  return {
    specHash: hashText(specRaw),
    overridesHash: hashText(overridesRaw),
    model: 'test-model',
    generatedAt: '2026-01-01T00:00:00.000Z',
    descriptions,
  };
}

describe('parseDescriptionCacheFile', () => {
  it('parses a well-formed cache', () => {
    const raw = JSON.stringify(cacheFor(SPEC, OVERRIDES, { listApps: 'Lists apps.' }));
    const parsed = parseDescriptionCacheFile(raw, 'x.json');
    expect(parsed.descriptions.listApps).toBe('Lists apps.');
  });

  it('rejects a file missing the required shape', () => {
    expect(() => parseDescriptionCacheFile('{"foo":"bar"}', 'x.json')).toThrow(/does not look like a description cache/);
  });

  it('rejects descriptions as an array (not a map)', () => {
    const bad = JSON.stringify({ specHash: 'a', overridesHash: 'b', descriptions: [] });
    expect(() => parseDescriptionCacheFile(bad, 'x.json')).toThrow(/description cache/);
  });
});

describe('resolveDescriptions', () => {
  it('reports fallback-no-cache when no cache is configured', () => {
    const result = resolveDescriptions(undefined, SPEC, OVERRIDES);
    expect(result.mode).toBe('fallback-no-cache');
    expect(result.descriptions).toEqual({});
  });

  it('reports llm-cache and returns the descriptions when hashes match exactly', () => {
    const cache = cacheFor(SPEC, OVERRIDES, { listApps: 'Lists every registered app.' });
    const result = resolveDescriptions(cache, SPEC, OVERRIDES);
    expect(result.mode).toBe('llm-cache');
    expect(result.descriptions).toEqual({ listApps: 'Lists every registered app.' });
  });

  it('reports fallback-stale-cache when the spec changed since the cache was generated', () => {
    const cache = cacheFor(SPEC, OVERRIDES, { listApps: 'Stale prose.' });
    const result = resolveDescriptions(cache, 'openapi: 3.1.0\npaths: { "/apps": {} }\n', OVERRIDES);
    expect(result.mode).toBe('fallback-stale-cache');
    expect(result.descriptions).toEqual({});
  });

  it('reports fallback-stale-cache when only the overrides changed', () => {
    const cache = cacheFor(SPEC, OVERRIDES, { listApps: 'Stale prose.' });
    const result = resolveDescriptions(cache, SPEC, 'tools: { deleteApp: { reversibility: irreversible } }\n');
    expect(result.mode).toBe('fallback-stale-cache');
    expect(result.descriptions).toEqual({});
  });

  it('never returns descriptions for a mode other than llm-cache', () => {
    for (const [cache, specRaw] of [
      [undefined, SPEC],
      [cacheFor('different', OVERRIDES, { x: 'y' }), SPEC],
    ] as const) {
      const result = resolveDescriptions(cache, specRaw, OVERRIDES);
      if (result.mode !== 'llm-cache') {
        expect(Object.keys(result.descriptions)).toHaveLength(0);
      }
    }
  });
});
