/**
 * Conformance of the CHECKED-IN gateway wiring against the CHECKED-IN specs.
 *
 * Unit tests in spec.test.ts prove the gateway's logic on synthetic specs. This
 * file proves the real files in this repo agree with each other, so the drift
 * class that shipped once cannot ship again:
 *
 *   - selection-lists overrides were keyed `archiveList` / `archiveItem` /
 *     `revokeAccess` while the spec's operationIds are `archiveSelectionList` /
 *     `archiveSelectionListItem` / `revokeSelectionListAccess`. The gateway read
 *     overrides[name] by exact key, so a wrong key was silently ignored and the
 *     file asserted reviewed decisions that were not in force.
 *
 * Runs in `mcp-gateway-image.yml` (paths: packages/mcp-gateway/**) and, via
 * gate-mcp-contract.yml, whenever a spec, overrides file or tool manifest moves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTools, findUnknownOverrideKeys } from '../src/spec.js';
import { loadDocument, loadOverrides } from '../src/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const at = (p: string) => resolve(repoRoot, p);

interface Gateway {
  name: string;
  spec: string;
  overrides: string;
  /** Checked-in tool manifest (mcp/*.json), when the gateway has one. */
  manifest?: string;
}

const GATEWAYS: Gateway[] = [
  {
    name: 'fuzefront-mcp',
    spec: 'services/app-registry-service/openapi.yaml',
    overrides: 'deploy/helm/fuzefront/files/mcp-tools.overrides.yaml',
    manifest: 'mcp/tools.json',
  },
  {
    name: 'selection-list-mcp',
    spec: 'services/selection-list-service/openapi.yaml',
    overrides: 'deploy/helm/fuzefront/files/mcp-tools-selection-lists.overrides.yaml',
    manifest: 'mcp/tools-selection-lists.json',
  },
  {
    name: 'config-service-mcp',
    spec: 'services/config-service/openapi.yaml',
    overrides: 'deploy/helm/fuzefront/files/mcp-tools-config.overrides.yaml',
  },
];

describe.each(GATEWAYS)('$name wiring', gw => {
  const doc = loadDocument(at(gw.spec));
  const overrides = loadOverrides(at(gw.overrides));
  // buildTools applies every classification invariant AND now throws on unknown
  // override keys, so a successful build is itself part of the assertion.
  const tools = buildTools(doc, overrides);
  const names = new Set(tools.map(t => t.name));

  it('every override key is an operationId that exists in the spec', () => {
    expect(findUnknownOverrideKeys(overrides, names)).toEqual([]);
  });

  it('boots: the spec + overrides pair satisfies every classification invariant', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  if (gw.manifest) {
    const manifestPath = gw.manifest;
    const manifest = JSON.parse(readFileSync(at(manifestPath), 'utf8')) as {
      tools: Array<{ name: string; mutates?: boolean }>;
    };

    it(`${manifestPath} lists exactly the tools the gateway derives`, () => {
      expect(manifest.tools.map(t => t.name).sort()).toEqual([...names].sort());
    });

    it(`${manifestPath} declares mutates on every tool, matching the gateway classification`, () => {
      const byName = new Map(manifest.tools.map(t => [t.name, t]));
      for (const t of tools) {
        const entry = byName.get(t.name);
        expect(typeof entry?.mutates, `${t.name} is missing "mutates"`).toBe('boolean');
        expect(entry?.mutates, `${t.name} mutates`).toBe(t.classification.mutates);
      }
    });
  }
});

describe('selection-list-mcp: forkSelectionList (contract 4.1.0)', () => {
  const doc = loadDocument(at('services/selection-list-service/openapi.yaml'));
  const overrides = loadOverrides(at('deploy/helm/fuzefront/files/mcp-tools-selection-lists.overrides.yaml'));
  const tools = buildTools(doc, overrides);
  const fork = tools.find(t => t.name === 'forkSelectionList');

  it('is exposed as POST /v1/selection-lists/{listId}/fork', () => {
    expect(fork).toBeDefined();
    expect(fork?.method).toBe('post');
    expect(fork?.path).toBe('/v1/selection-lists/{listId}/fork');
  });

  it('is a reversible WRITE, never a read and never irreversible', () => {
    expect(fork?.classification.mutates).toBe(true);
    expect(fork?.classification.reversibility).toBe('reversible');
    expect(fork?.description.startsWith('[WRITE]')).toBe(true);
  });

  it('has an explicit, reasoned override entry (not just the derived default)', () => {
    expect(overrides.forkSelectionList).toMatchObject({ mutates: true, reversibility: 'reversible' });
    expect(overrides.forkSelectionList?.reason).toMatch(/idempotent/i);
  });

  it('requires listId and takes an optional body that carries no id (service mints ids)', () => {
    const schema = fork?.inputSchema as {
      required?: string[];
      properties: Record<string, { properties?: Record<string, unknown>; additionalProperties?: boolean }>;
    };
    expect(schema.required).toEqual(['listId']);
    expect(Object.keys(schema.properties).sort()).toEqual(['body', 'listId']);
    expect(schema.properties.body.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.body.properties ?? {})).toEqual(['visibility']);
  });
});
