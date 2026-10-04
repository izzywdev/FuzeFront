// Fixtures for the seed library's real-Postgres tests.

import type { Knex } from 'knex';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';
import type { SeedApplyRequest } from '../../src/seed';

export const orgId = (n: number): string => fromUuid('organization', `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d${String(n).padStart(2, '0')}`);

export interface ProjectionOpts {
  type?: 'platform' | 'organization' | 'personal';
  isActive?: boolean;
  status?: 'active' | 'deleted';
}

/** What the (future) identity.org.created consumer writes: the org in the projection. */
export async function projectOrg(db: Knex, wireId: string, opts: ProjectionOpts = {}): Promise<void> {
  await db('selection_list_ref_index').insert({
    entity_type: 'organization',
    entity_id: toUuid(wireId as never),
    wire_id: wireId,
    status: opts.status ?? 'active',
    org_type: opts.type ?? 'organization',
    is_active: opts.isActive ?? true,
  });
}

export const FUZECRM_SUBJECT = 'fuzecrm-service';

/** An allowlisted app source (what syncSeedSources would write from seed-sources.json). */
export async function allowSource(
  db: Knex,
  app: string,
  over: Partial<{ subjects: string[]; prefixes: string[]; maxLists: number; maxItems: number; enabled: boolean }> = {},
): Promise<void> {
  await db('selection_list_seed_sources').insert({
    app,
    allowed_subjects: over.subjects ?? [FUZECRM_SUBJECT],
    key_prefixes: over.prefixes ?? [`${app}-`],
    max_lists_per_request: over.maxLists ?? 20,
    max_items_per_request: over.maxItems ?? 2000,
    enabled: over.enabled ?? true,
  });
}

export function spec(key: string, items: Array<string | { code: string; label?: string }>, over: Record<string, unknown> = {}) {
  return {
    key,
    sourceLocale: 'en' as const,
    name: `List ${key}`,
    translations: [{ locale: 'es' as const, name: `Lista ${key}` }],
    items: items.map((i) => {
      const code = typeof i === 'string' ? i : i.code;
      const label = typeof i === 'string' ? code.toLowerCase() : (i.label ?? code.toLowerCase());
      return { code, label, translations: [{ locale: 'es' as const, label: `${label}-es` }] };
    }),
    ...over,
  };
}

/** A request from an allowlisted app source (`fuzecrm`). */
export function appRequest(org: string, over: Partial<SeedApplyRequest> = {}): SeedApplyRequest {
  return {
    organizationId: org,
    scope: 'org',
    source: { app: 'fuzecrm', service: 'fuzecrm-service' },
    pack: { key: 'crm-defaults', version: 1 },
    trigger: 'app-installed',
    requestId: 'fuzecrm:req-1',
    lists: [spec('fuzecrm-stages', ['LEAD', 'WON'])],
    attestedSubject: FUZECRM_SUBJECT,
    ...over,
  };
}

export interface OutboxEvent {
  topic: string;
  payload: Record<string, any>;
}

/** Outbox rows with seq > `after`, oldest first. */
export async function eventsAfter(db: Knex, after: string | number = 0): Promise<OutboxEvent[]> {
  const rows = await db('event_outbox').where('seq', '>', String(after)).orderBy('seq');
  return rows.map((r: any) => ({ topic: r.topic, payload: r.payload }));
}

export async function maxSeq(db: Knex): Promise<string> {
  const r = await db('event_outbox').max('seq as m').first();
  return String((r as any)?.m ?? 0);
}

export const countBy = (events: OutboxEvent[], topic: string): number => events.filter((e) => e.topic === topic).length;
