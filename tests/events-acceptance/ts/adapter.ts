/**
 * THE ONLY FILE that knows `@izzywdev/fuzefront-events`' API (slice B3).
 * Tests call the functions below and assert contract behaviour (tables.md, envelope v2,
 * vectors). When the package's real signatures land, adapt HERE.
 */
import { Kafka, Producer } from 'kafkajs'
import knex, { Knex } from 'knex'
import * as fs from 'fs'
import * as path from 'path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

export const ROOT = path.resolve(__dirname, '../../..')
export const PG_URL = process.env.DATABASE_URL
export const BROKERS = (process.env.KAFKA_BROKERS || '').split(',').filter(Boolean)
/** CI sets KAFKA_BROKERS (real broker). Without it the suite runs against an in-process bus that
 *  honours the same package ports (RelayTransport / processMessage) - fast local verification only. */
export const USE_KAFKA = BROKERS.length > 0
export const INFRA_READY = !!PG_URL

let pkg: any = null
let pkgError = ''
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pkg = require('@izzywdev/fuzefront-events')
} catch (e: any) {
  pkgError = String(e?.message || e)
}
export const PKG_AVAILABLE = pkg !== null
export const PKG_REASON =
  'RED pending packages/events (@izzywdev/fuzefront-events, slice B1) - not resolvable: ' + pkgError.split('\n')[0]

/** Test wrapper: real test when the package exists, `test.failing` (RED, reason in name) otherwise. */
export const acc: jest.It = ((name: string, fn: any, t?: number) =>
  PKG_AVAILABLE
    ? it(name, fn, t)
    : // fail fast and deterministically (no broker/db dance); the body is the contract spec and runs for real once the package resolves
      (it as any).failing(name, async () => { throw new Error(PKG_REASON) }, t)) as any
export const accName = (n: string) => (PKG_AVAILABLE ? n : `${n} [${PKG_REASON}]`)
export const describeInfra: jest.Describe = (INFRA_READY ? describe : describe.skip) as any

// ---------- contract helpers (independent of the package) ----------
// Fixed table of literal paths keyed by a union type: no function parameter flows into path.join/resolve.
export type VectorName = 'versionGuard' | 'dedupe' | 'valid' | 'invalid'
const VECTOR_FILES: Record<VectorName, string> = {
  versionGuard: path.join(ROOT, 'packages/conformance-vectors/events/version-guard.json'),
  dedupe: path.join(ROOT, 'packages/conformance-vectors/events/dedupe.json'),
  valid: path.join(ROOT, 'packages/conformance-vectors/events/envelopes.valid.json'),
  invalid: path.join(ROOT, 'packages/conformance-vectors/events/envelopes.invalid.json'),
}
export const vectors = (name: VectorName) => JSON.parse(fs.readFileSync(VECTOR_FILES[name], 'utf8'))

const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
const ENVELOPE_SCHEMA = path.join(ROOT, 'contracts/events/envelope.v2.schema.json')
const envSchema = JSON.parse(fs.readFileSync(ENVELOPE_SCHEMA, 'utf8'))
export const validateEnvelopeV2 = ajv.compile(envSchema)

const SCHEMA_SQL = path.join(__dirname, '../sql/schema.sql')
export async function resetSchema(db: Knex) {
  await db.raw(fs.readFileSync(SCHEMA_SQL, 'utf8'))
}
export const connectDb = (): Knex => knex({ client: 'pg', connection: PG_URL, pool: { min: 0, max: 8 } })

export const rnd = () => Math.random().toString(36).slice(2, 10)
const B32 = '0123456789abcdefghjkmnpqrstvwxyz'
export function typeId(prefix: string): string {
  let s = '0'
  for (let i = 0; i < 25; i++) s += B32[Math.floor(Math.random() * 32)]
  return `${prefix}_${s}`
}
export const newTopic = () => `acc.t${rnd()}`

export function rawEnvelope(o: {
  topic: string
  aggregateId: string
  aggregateVersion: number
  payload?: any
  eventId?: string
  aggregateType?: string
}) {
  return {
    eventId: o.eventId || typeId('evt'),
    topic: o.topic,
    schemaVersion: 1,
    aggregateType: o.aggregateType || 'organization',
    aggregateId: o.aggregateId,
    aggregateVersion: o.aggregateVersion,
    producer: 'acceptance-suite',
    occurredAt: new Date().toISOString(),
    correlationId: 'corr-' + rnd(),
    payload: o.payload ?? { kind: 'updated', data: {} },
  }
}

// ---------- message bus: real Kafka (CI) or in-process (local) ----------
interface BusMsg { key: string | null; value: any; partition: number; offset: number }
const mem = new Map<string, BusMsg[]>()
const memListeners = new Map<string, Array<(m: BusMsg, topic: string) => Promise<void>>>()
let memChain: Promise<void> = Promise.resolve()
async function memPush(topic: string, key: string | null, raw: string) {
  const list = mem.get(topic) || []; mem.set(topic, list)
  const m: BusMsg = { key, value: JSON.parse(raw), partition: 0, offset: list.length }
  list.push(m)
  // deliver sequentially, in append order (single partition)
  memChain = memChain.then(async () => { for (const l of memListeners.get(topic) || []) await l(m, topic) }).catch(() => {})
}

const kafka = () => new Kafka({ clientId: 'acc-suite', brokers: BROKERS, logLevel: 1 })
export async function createTopic(topic: string, partitions = 1) {
  if (!USE_KAFKA) { mem.set(topic, mem.get(topic) || []); mem.set(`${topic}.dlq`, mem.get(`${topic}.dlq`) || []); return }
  const admin = kafka().admin()
  await admin.connect()
  await admin.createTopics({ topics: [{ topic, numPartitions: partitions }, { topic: `${topic}.dlq`, numPartitions: 1 }] })
  await admin.disconnect()
}
let rawProducer: Producer | null = null
async function kafkaProducer(): Promise<Producer> {
  if (!rawProducer) { rawProducer = kafka().producer(); await rawProducer.connect() }
  return rawProducer
}
export async function produceRaw(topic: string, msgs: { key?: string; value: any }[]) {
  if (!USE_KAFKA) { for (const m of msgs) await memPush(topic, m.key ?? null, JSON.stringify(m.value)); return }
  await (await kafkaProducer()).send({ topic, messages: msgs.map((m) => ({ key: m.key, value: JSON.stringify(m.value) })) })
}
export async function closeRaw() {
  if (rawProducer) await rawProducer.disconnect()
  rawProducer = null
}
/** Read every message currently on `topic` (fresh group, from beginning) until `idleMs` of silence. */
export async function readAll(topic: string, idleMs = 4000): Promise<{ key: string | null; value: any }[]> {
  if (!USE_KAFKA) { await memChain; return (mem.get(topic) || []).map((m) => ({ key: m.key, value: m.value })) }
  const c = kafka().consumer({ groupId: 'acc-read-' + rnd() })
  await c.connect()
  await c.subscribe({ topic, fromBeginning: true })
  const out: { key: string | null; value: any }[] = []
  let last = Date.now()
  await c.run({
    eachMessage: async ({ message }) => {
      last = Date.now()
      out.push({ key: message.key ? message.key.toString() : null, value: JSON.parse(message.value!.toString()) })
    },
  })
  while (Date.now() - last < idleMs) await new Promise((r) => setTimeout(r, 250))
  await c.disconnect()
  return out
}

// ---------- package adapter (@izzywdev/fuzefront-events; wired to packages/events on PR #1297) ----------
export interface EventInput {
  topic: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  payload: any
  producer?: string
  correlationId?: string
}
export type Transport = { send(topic: string, message: { key: string; value: string }): Promise<void> }

export function buildEvent(i: EventInput): any {
  return pkg.buildEvent({ producer: 'acceptance-suite', correlationId: 'corr-' + rnd(), schemaVersion: 1, ...i })
}
export async function enqueue(trx: Knex.Transaction, event: any): Promise<void> {
  await pkg.enqueueEvent(trx, event)
}
/** Transport onto the bus; tests wrap `send` to inject faults (failed-head / DLQ / slow publisher). */
export async function realTransport(): Promise<Transport> {
  if (!USE_KAFKA) return { send: async (topic, m) => { await memPush(topic, m.key, m.value) } }
  return pkg.kafkaTransport(await kafkaProducer())
}
/** Run `rounds` relay claim passes (each `drainOnce`). Pass a separate `db` to emulate another replica. */
export async function drain(db: Knex, opts: { transport: Transport; maxAttempts?: number; rounds?: number; batchSize?: number }): Promise<void> {
  const relay = pkg.createOutboxRelay({
    db: pkg.knexDb(db), transport: opts.transport, maxAttempts: opts.maxAttempts ?? 3, batchSize: opts.batchSize ?? 20,
    logger: pkg.silentLogger,
  })
  for (let i = 0; i < (opts.rounds ?? 10); i++) await relay.drainOnce()
}
/** Operator action: dead-lettered `failed` row back to `pending`. */
export async function requeue(db: Knex, eventId: string): Promise<boolean> {
  return pkg.requeueFailedEvent(pkg.knexDb(db), eventId)
}

export interface Handle {
  stop(): Promise<void>
  /** Re-run the runtime on an already-seen record (same topic/partition/offset): broker redelivery. */
  redeliver(topic: string, partition: number, offset: number, value: any): Promise<string>
}
/** handler(envelope, tx, ctx) runs inside the consumer's dedupe transaction; tx = package SqlClient ($n placeholders). */
export async function startConsumer(o: {
  groupId: string
  topics: string[]
  db: Knex
  handler: (env: any, tx: any, ctx: any) => Promise<void>
  maxAttempts?: number
}): Promise<Handle> {
  const memKafka = {
    producer: () => ({
      connect: async () => {}, disconnect: async () => {},
      send: async (r: any) => { for (const m of r.messages) await memPush(r.topic, m.key ?? null, m.value) },
    }),
    consumer: () => ({ connect: async () => {}, subscribe: async () => {}, run: async () => {}, disconnect: async () => {} }),
  }
  const c = pkg.createConsumer({
    groupId: o.groupId, topics: o.topics, db: pkg.knexDb(o.db),
    kafka: USE_KAFKA ? new Kafka({ clientId: 'acc-consumer', brokers: BROKERS, logLevel: 1 }) : memKafka,
    fromBeginning: true, maxAttempts: o.maxAttempts ?? 3, backoffMs: () => 20, logger: pkg.silentLogger,
    // the projection owns the stored version (tables.md); the runtime only compares
    getStoredVersion: async (ev: any, tx: any) => {
      const r = await tx.query('SELECT version FROM acc_proj WHERE aggregate_id = $1', [ev.aggregateId])
      return r.rows[0] ? Number(r.rows[0].version) : null
    },
    handler: (ev: any, ctx: any) => o.handler(ev, ctx.tx, ctx),
  })
  await c.start()
  const listener = async (m: BusMsg, topic: string) => {
    await c.processMessage({ topic, partition: m.partition, offset: String(m.offset), value: Buffer.from(JSON.stringify(m.value)) })
  }
  if (!USE_KAFKA) {
    for (const t of o.topics) {
      memListeners.set(t, [...(memListeners.get(t) || []), listener])
      for (const m of mem.get(t) || []) await listener(m, t) // fromBeginning replay
    }
  } else await new Promise((r) => setTimeout(r, 3000)) // let the group join before producers send
  return {
    stop: async () => {
      for (const t of o.topics) memListeners.set(t, (memListeners.get(t) || []).filter((l) => l !== listener))
      await memChain
      await c.stop()
    },
    redeliver: (topic, partition, offset, value) =>
      c.processMessage({ topic, partition, offset: String(offset), value: Buffer.from(JSON.stringify(value)) }),
  }
}

export async function waitFor(fn: () => Promise<boolean>, ms = 30000, what = 'condition') {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timeout waiting for ' + what)
}

/** Standard test handler: records an effect and applies {kind,data} to acc_proj using the event's version. */
export const projectionHandler = async (env: any, tx: any) => {
  await tx.query('INSERT INTO acc_effects (event_key, aggregate_id) VALUES ($1, $2)', [env.eventId ?? 'v1', env.aggregateId ?? null])
  if (!env.aggregateId) return
  const { kind, data } = env.payload || {}
  await tx.query(
    `INSERT INTO acc_proj (aggregate_id, version, deleted, data) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (aggregate_id) DO UPDATE SET version = EXCLUDED.version, deleted = EXCLUDED.deleted, data = EXCLUDED.data`,
    [env.aggregateId, env.aggregateVersion, kind === 'deleted', kind === 'deleted' ? null : JSON.stringify(data)],
  )
}
export async function projState(db: Knex): Promise<Record<string, any>> {
  const rows = await db('acc_proj')
  return Object.fromEntries(rows.map((r: any) => [r.aggregate_id, { version: Number(r.version), deleted: r.deleted, data: r.data }]))
}
export const SENTINEL_AGG = () => typeId('org')
