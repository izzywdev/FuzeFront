// registry.ts — the spec registry (docs/planning/developers-portal.md §4.2).
//
// `upsertSpec` is the ONE write path, used by both:
//   - the bootstrap harvest (routes/specs.ts's internal seed call, reading
//     the specs/ directory this repo's own CI bakes in — see
//     scripts/collect-devportal-specs.mjs), and
//   - the future cross-repo PUSH mechanism (§4.2, Phase 5): a family repo's
//     CI POSTing its own openapi.yaml to POST /internal/specs.
// Both converge on the same table/shape so the catalog never has two
// different representations of "a harvested spec".

import * as yaml from 'js-yaml';
import { db } from '../db';

export interface SpecRecord {
  id: string;
  repo: string;
  service: string;
  specPath: string;
  version: string;
  rawSpec: Record<string, unknown>;
  fetchedAt: string;
}

function toRecord(row: any): SpecRecord {
  return {
    id: row.id,
    repo: row.repo,
    service: row.service,
    specPath: row.spec_path,
    version: row.version,
    rawSpec: typeof row.raw_spec === 'string' ? JSON.parse(row.raw_spec) : row.raw_spec,
    fetchedAt: row.fetched_at instanceof Date ? row.fetched_at.toISOString() : row.fetched_at,
  };
}

export interface UpsertSpecInput {
  repo: string;
  service: string;
  specPath: string;
  specYaml: string;
}

/** Parses+validates a raw OpenAPI YAML string and upserts it into the registry. */
export async function upsertSpec(input: UpsertSpecInput): Promise<SpecRecord> {
  const parsed = yaml.load(input.specYaml) as Record<string, unknown> | undefined;
  if (!parsed || typeof parsed !== 'object' || !('openapi' in parsed)) {
    throw new Error(`${input.specPath}: not a valid OpenAPI document (missing "openapi" field)`);
  }
  const version = String((parsed as any).info?.version ?? 'unknown');

  const [row] = await db('devportal_specs')
    .insert({
      repo: input.repo,
      service: input.service,
      spec_path: input.specPath,
      version,
      raw_spec: JSON.stringify(parsed),
      fetched_at: new Date(),
    })
    .onConflict(['repo', 'service'])
    .merge({
      spec_path: input.specPath,
      version,
      raw_spec: JSON.stringify(parsed),
      fetched_at: new Date(),
      updated_at: new Date(),
    })
    .returning('*');

  return toRecord(row);
}

export interface CatalogEntry {
  id: string;
  repo: string;
  service: string;
  version: string;
  title: string;
  description: string;
  tags: string[];
  fetchedAt: string;
}

/** Lightweight catalog listing — no full spec bodies (§7 Catalog page). */
export async function listCatalog(): Promise<CatalogEntry[]> {
  const rows = await db('devportal_specs').select('*').orderBy(['repo', 'service']);
  return rows.map(row => {
    const spec = typeof row.raw_spec === 'string' ? JSON.parse(row.raw_spec) : row.raw_spec;
    const tagNames = new Set<string>();
    for (const op of Object.values((spec.paths ?? {}) as Record<string, any>)) {
      for (const method of Object.values(op as Record<string, any>)) {
        for (const t of method?.tags ?? []) tagNames.add(t);
      }
    }
    return {
      id: row.id,
      repo: row.repo,
      service: row.service,
      version: row.version,
      title: spec.info?.title ?? row.service,
      description: spec.info?.description ?? '',
      tags: Array.from(tagNames),
      fetchedAt: row.fetched_at instanceof Date ? row.fetched_at.toISOString() : row.fetched_at,
    };
  });
}

/** Full spec (§7 Spec viewer) by repo+service. */
export async function getSpec(repo: string, service: string): Promise<SpecRecord | null> {
  const row = await db('devportal_specs').where({ repo, service }).first();
  return row ? toRecord(row) : null;
}

export async function getSpecById(id: string): Promise<SpecRecord | null> {
  const row = await db('devportal_specs').where({ id }).first();
  return row ? toRecord(row) : null;
}
