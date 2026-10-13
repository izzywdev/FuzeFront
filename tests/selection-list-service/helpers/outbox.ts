/**
 * Outbox observation helpers.
 *
 * The service writes one `event_outbox` row per emitted event, inside the same transaction as
 * the state change (docs/planning/selection-lists-events.md §6). Without a Kafka broker (CI) no
 * relay runs and rows stay `pending`; with one they become `sent`. Either way the row is the
 * observable record of "an event was emitted", so the suite drives the service over HTTP and
 * asserts through the SAME database the service uses.
 *
 * Payloads are validated with the FROZEN shared Zod schemas (`schemaForTopic`), never with the
 * implementation's own types.
 */
import { schemaForTopic, TOPICS } from '@fuzefront/shared/kafka';
import { dbQuery } from './db';

export { TOPICS };

export interface OutboxRow {
  id: string;
  seq: string;
  organization_id: string;
  topic: string;
  payload: Record<string, any>;
  correlation_id: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  created_at: Date;
}

/** Highest outbox `seq` right now ('0' when empty). Use as a watermark before an action. */
export async function maxSeq(): Promise<string> {
  const rows = await dbQuery<{ m: string | null }>('SELECT max(seq)::text AS m FROM event_outbox');
  return rows[0]?.m ?? '0';
}

/** Rows for one org written after `afterSeq`, in `seq` order (the relay's per-org order). */
export async function eventsSince(orgId: string, afterSeq: string): Promise<OutboxRow[]> {
  return dbQuery<OutboxRow>(
    'SELECT * FROM event_outbox WHERE organization_id = $1 AND seq > $2::bigint ORDER BY seq',
    [orgId, afterSeq],
  );
}

/** All rows for one org, in `seq` order. */
export async function allEvents(orgId: string): Promise<OutboxRow[]> {
  return eventsSince(orgId, '0');
}

export const topicsOf = (rows: OutboxRow[]): string[] => rows.map((r) => r.topic);

/** Zod issues for a payload against the frozen schema for its topic ([] = valid). */
export function payloadErrors(topic: string, payload: unknown): string[] {
  const schema = schemaForTopic(topic);
  if (!schema) return [`no schema registered for topic ${topic}`];
  const parsed = schema.safeParse(payload);
  if (parsed.success) return [];
  return (parsed as { error: { issues: Array<{ path: Array<string | number>; message: string }> } }).error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
}

/**
 * Distinct writer-transaction ids (`xmin`) of the given outbox rows: exactly ONE value <=> every row was
 * written by the same transaction. (`created_at` cannot prove it: the writer stamps `clock_timestamp()`.)
 * `xmin` of a row is its inserting transaction only while the row is untouched, so this holds for runs WITHOUT
 * a live relay, i.e. without KAFKA_BROKERS - the CI default, and the precondition of the other outbox suites
 * (a relay marking rows `sent` would rewrite their `xmin`).
 */
export async function transactionIds(rows: Array<{ id: string }>): Promise<string[]> {
  if (rows.length === 0) return [];
  const res = await dbQuery<{ x: string }>('SELECT DISTINCT xmin::text AS x FROM event_outbox WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
  return res.map((r) => r.x);
}

/**
 * Run one action and return exactly the org's outbox rows it produced, in order.
 * (Runs sequentially within a test file; each test file uses its own org so parallel jest
 * workers never see each other's rows.)
 */
export async function eventsFrom<T>(orgId: string, action: () => Promise<T>): Promise<{ result: T; events: OutboxRow[] }> {
  const mark = await maxSeq();
  const result = await action();
  return { result, events: await eventsSince(orgId, mark) };
}
