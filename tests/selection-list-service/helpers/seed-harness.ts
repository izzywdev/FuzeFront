/**
 * Harness for the Kafka-free seeding acceptance tests (contract/seeding.test.ts).
 *
 * The seeding consumers (`identity.org.created`, `selection-lists.seed.requested`) are Kafka
 * consumers; CI runs the service WITHOUT a broker, so the only Kafka-free entry points are the
 * compiled handlers the consumers call (`dist/events/*.handler.js`) and the public seed library
 * (`dist/seed`). The suite drives those against the SAME Postgres the running service uses and
 * asserts through the database (and, for the HTTP-visible half, through the running service).
 *
 * What is real: Postgres + migrations, the handlers, the seed library, the outbox writer, the
 * attestation verifier (`@fuzefront/service-auth` introspection) — talking to an in-process fake
 * of the Security API's introspection endpoint that this harness owns, so inactive / expired /
 * wrong-scope / wrong-subject / outage are decided by the production code path.
 * What is faked: the Kafka transport, and the introspection endpoint.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bytesToUuid, mintId, toUuid, uuidv7Bytes } from '@izzywdev/fuzefront-identity';
import { dbQuery } from './db';
import { allEvents, OutboxRow } from './outbox';


/** A fresh org: wire TypeID (what tokens/HTTP/events carry) + the bare UUID identity events carry. */
export function newOrg(): { wire: string; uuid: string } {
  const wire = mintId('organization') as string;
  return { wire, uuid: toUuid(wire as never) };
}

export function newUser(): { wire: string; uuid: string } {
  const wire = mintId('user') as string;
  return { wire, uuid: toUuid(wire as never) };
}

export const newUuid = (): string => bytesToUuid(uuidv7Bytes());

// ---------------------------------------------------------------------------------------------
// Fake introspection endpoint (what the real verifier talks to)
// ---------------------------------------------------------------------------------------------

export type TokenEntry = { active: boolean; subject?: string; scope?: string; expiresAt?: number } | 'outage' | 'http500';

export class FakeIntrospection {
  readonly tokens = new Map<string, TokenEntry>();
  /** Every token the verifier asked about (to prove a refusal happened BEFORE introspection). */
  readonly asked: string[] = [];
  private server?: http.Server;
  url = '';

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const token = (() => {
          try {
            return JSON.parse(raw).token as string;
          } catch {
            return '';
          }
        })();
        this.asked.push(token);
        const entry = this.tokens.get(token) ?? { active: false };
        if (entry === 'outage') {
          req.socket.destroy();
          return;
        }
        if (entry === 'http500') {
          res.writeHead(500, { 'content-type': 'application/json' }).end('{}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(entry));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

export const nowS = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

export function orgCreatedEnvelope(org: { uuid: string }, over: Record<string, unknown> = {}, correlationId = 'sl7-org-created') {
  return {
    version: '1.0',
    topic: 'identity.org.created',
    correlationId,
    occurredAt: new Date().toISOString(),
    payload: { organizationId: org.uuid, slug: `org-${org.uuid.slice(-6)}`, name: 'Acme', type: 'organization', parentId: null, ownerId: null, isActive: true, ...over },
  };
}

export function orgDeletedEnvelope(org: { uuid: string }, cascade: 'soft' | 'hard' = 'soft') {
  return {
    version: '1.0',
    topic: 'identity.org.deleted',
    correlationId: 'sl7-org-deleted',
    occurredAt: new Date().toISOString(),
    payload: { organizationId: org.uuid, slug: 'acme', ownerId: null, cascade },
  };
}

export function userDeletedEnvelope(user: { uuid: string }) {
  return {
    version: '1.0',
    topic: 'identity.user.deleted',
    correlationId: 'sl7-user-deleted',
    occurredAt: new Date().toISOString(),
    payload: { userId: user.uuid, cascade: 'soft' },
  };
}

export function seedEnvelope(payload: unknown, correlationId = 'sl7-seed-requested') {
  return { version: '1.0', topic: 'selection-lists.seed.requested', correlationId, occurredAt: new Date().toISOString(), payload };
}

export interface ItemSpec {
  code: string;
  label?: string;
}

/** A seed list spec (strict shape: no ids) with an `es` translation on the list and every item. */
export function listSpec(key: string, items: Array<string | ItemSpec>, over: Record<string, unknown> = {}) {
  return {
    key,
    sourceLocale: 'en',
    name: `List ${key}`,
    translations: [{ locale: 'es', name: `Lista ${key}` }],
    items: items.map((i) => {
      const code = typeof i === 'string' ? i : i.code;
      const label = typeof i === 'string' ? `Label ${code}` : (i.label ?? `Label ${code}`);
      return { code, label, translations: [{ locale: 'es', label: `${label} (es)` }] };
    }),
    ...over,
  };
}

export const SOURCE_APP = 'sl7app';
export const SOURCE_SUBJECT = 'sl7-service';

export function seedPayload(orgWire: string, token: string, over: Record<string, unknown> = {}) {
  return {
    requestId: `sl7:${newUuid().slice(0, 8)}`,
    organizationId: orgWire,
    scope: 'org',
    source: { app: SOURCE_APP, service: SOURCE_SUBJECT },
    pack: { key: 'sl7-pack', version: 1 },
    trigger: 'app-installed',
    attestation: { kind: 'service-token', token },
    lists: [listSpec(`${SOURCE_APP}-stages`, ['LEAD', 'WON'])],
    ...over,
  };
}

/** Upsert an allowlisted source row (what `seed-sources.json` sync would write). */
export async function allowSource(
  app: string,
  over: Partial<{ subjects: string[]; prefixes: string[]; maxLists: number; maxItems: number; enabled: boolean }> = {},
): Promise<void> {
  await dbQuery(
    `INSERT INTO selection_list_seed_sources (app, allowed_subjects, key_prefixes, max_lists_per_request, max_items_per_request, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (app) DO UPDATE SET allowed_subjects = EXCLUDED.allowed_subjects, key_prefixes = EXCLUDED.key_prefixes,
       max_lists_per_request = EXCLUDED.max_lists_per_request, max_items_per_request = EXCLUDED.max_items_per_request,
       enabled = EXCLUDED.enabled, updated_at = now()`,
    [app, over.subjects ?? [SOURCE_SUBJECT], over.prefixes ?? [`${app}-`], over.maxLists ?? 20, over.maxItems ?? 2000, over.enabled ?? true],
  );
}

/** Per-org quota override (the service's own production mechanism for a non-default ceiling). */
export async function setOrgQuota(orgWire: string, maxLists: number, maxItemsPerList: number): Promise<void> {
  await dbQuery(
    `INSERT INTO selection_list_org_quota (organization_id, max_lists, max_items_per_list, updated_by, updated_at)
     VALUES ($1, $2, $3, 'sl7-acceptance', now())
     ON CONFLICT (organization_id) DO UPDATE SET max_lists = EXCLUDED.max_lists, max_items_per_list = EXCLUDED.max_items_per_list, updated_at = now()`,
    [orgWire, maxLists, maxItemsPerList],
  );
}

// ---------------------------------------------------------------------------------------------
// DB observations
// ---------------------------------------------------------------------------------------------

export const listRows = (orgWire: string) =>
  dbQuery('SELECT * FROM selection_lists WHERE organization_id = $1 ORDER BY key', [orgWire]);

export const itemRows = (orgWire: string) =>
  dbQuery(
    `SELECT i.* FROM selection_list_items i JOIN selection_lists l ON l.id = i.list_id
      WHERE l.organization_id = $1 ORDER BY l.key, i.sort_order`,
    [orgWire],
  );

export const ledgerRows = (orgWire: string) =>
  dbQuery('SELECT * FROM selection_list_seed_ledger WHERE organization_id = $1 ORDER BY seed_source, seed_key, version', [orgWire]);

export async function projectionRow(orgUuid: string) {
  const rows = await dbQuery("SELECT * FROM selection_list_ref_index WHERE entity_type = 'organization' AND entity_id = $1", [orgUuid]);
  return rows[0] as Record<string, any> | undefined;
}

export const countTopic = (rows: OutboxRow[], topic: string): number => rows.filter((r) => r.topic === topic).length;

/** Outbox rows after the index `from` of the org's full, seq-ordered history. */
export async function eventsAfterIndex(orgWire: string, from: number): Promise<OutboxRow[]> {
  return (await allEvents(orgWire)).slice(from);
}

// ---------------------------------------------------------------------------------------------
// The support path (docs/planning/selection-lists-permit-actions.md §5)
// ---------------------------------------------------------------------------------------------

const FAKE_SECURITY_URL = process.env['FAKE_SECURITY_URL'] ?? 'http://localhost:3002';

/**
 * Grant a user `list-owner` on one list through the Security API with a MACHINE token — exactly
 * the explicit, audited route §5 prescribes for a tenant admin (or anyone) to reach a list it holds
 * no instance role on. Seeded lists carry no owner, so this is also the only way to read/edit one
 * over HTTP. Targets the stand-in Security API the service itself authorizes against.
 */
export async function supportGrantOwner(orgWire: string, userWire: string, listId: string): Promise<void> {
  const tok = await fetch(`${FAKE_SECURITY_URL}/api/v1/security/tokens/workload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serviceAccountToken: 'selection-list-service-ci-projected-token',
    }),
  });
  if (tok.status !== 200) throw new Error(`stand-in Security API refused to issue a machine token (${tok.status})`);
  const { accessToken } = (await tok.json()) as { accessToken: string };
  const res = await fetch(`${FAKE_SECURITY_URL}/api/v1/security/authz/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ subject: userWire, tenant: orgWire, role: 'list-owner', resource: { type: 'SelectionList', key: listId } }),
  });
  if (res.status !== 201) throw new Error(`support-path grant failed (${res.status})`);
}
