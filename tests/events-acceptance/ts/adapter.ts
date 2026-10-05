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
export const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',')
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
export const vectors = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/conformance-vectors/events', f), 'utf8'))

const ajv = new Ajv2020({ strict: false })
addFormats(ajv)
const envSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/events/envelope.v2.schema.json'), 'utf8'))
export const validateEnvelopeV2 = ajv.compile(envSchema)

export async function resetSchema(db: Knex) {
  await db.raw(fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8'))
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

// ---------- Kafka raw access (no package involvement) ----------
const kafka = () => new Kafka({ clientId: 'acc-suite', brokers: BROKERS })
export async function createTopic(topic: string, partitions = 1) {
  const admin = kafka().admin()
  await admin.connect()
  await admin.createTopics({ topics: [{ topic, numPartitions: partitions }, { topic: `${topic}.dlq`, numPartitions: 1 }] })
  await admin.disconnect()
}
let rawProducer: Producer | null = null
export async function produceRaw(topic: string, msgs: { key?: string; value: any }[]) {
  if (!rawProducer) {
    rawProducer = kafka().producer()
    await rawProducer.connect()
  }
  await rawProducer.send({
    topic,
    messages: msgs.map((m) => ({ key: m.key, value: JSON.stringify(m.value) })),
  })
}
export async function closeRaw() {
  if (rawProducer) await rawProducer.disconnect()
  rawProducer = null
}
/** Read every message currently on `topic` (fresh group, from beginning) until `idleMs` of silence. */
export async function readAll(topic: string, idleMs = 4000): Promise<{ key: string | null; value: any }[]> {
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

// ---------- package adapter (ADAPT HERE when B1 lands) ----------
export interface EventInput {
  topic: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: number
  payload: any
  producer?: string
  correlationId?: string
}

export function buildEvent(i: EventInput): any {
  return pkg.buildEvent({ producer: 'acceptance-suite', correlationId: 'corr-' + rnd(), schemaVersion: 1, ...i })
}
export async function enqueue(trx: Knex.Transaction, event: any): Promise<void> {
  await pkg.enqueueEvent(trx, event)
}
export type Publish = (topic: string, key: string, envelope: any) => Promise<void>
/** Real publisher onto the test broker, supplied to the relay (so tests can wrap it to inject faults). */
export async function realPublisher(): Promise<Publish> {
  return async (topic, key, envelope) => produceRaw(topic, [{ key, value: envelope }])
}
/** Run relay claim/publish cycles until nothing more is claimable (or `rounds` exhausted). */
export async function drain(db: Knex, opts: { publish: Publish; maxAttempts?: number; rounds?: number }): Promise<void> {
  const rounds = opts.rounds ?? 10
  for (let i = 0; i < rounds; i++) {
    await pkg.drainOutboxOnce(db, { publish: opts.publish, maxAttempts: opts.maxAttempts ?? 3 })
  }
}

export interface Handle { stop(): Promise<void> }
/** handler(envelope, trx) runs inside the consumer's dedupe transaction. */
export async function startConsumer(o: {
  groupId: string
  topics: string[]
  db: Knex
  handler: (env: any, trx: Knex.Transaction) => Promise<void>
}): Promise<Handle> {
  const c = await pkg.createConsumer({ ...o, brokers: BROKERS, fromBeginning: true })
  await c.start()
  await new Promise((r) => setTimeout(r, 3000)) // let the group join/assign before producers send
  return { stop: () => c.stop() }
}

export async function waitFor(fn: () => Promise<boolean>, ms = 30000, what = 'condition') {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('timeout waiting for ' + what)
}

/** Standard test handler: records an effect and applies {kind,data} to acc_proj using the event's version. */
export const projectionHandler = async (env: any, trx: Knex.Transaction) => {
  await trx('acc_effects').insert({ event_key: env.eventId ?? 'v1', aggregate_id: env.aggregateId ?? null })
  if (!env.aggregateId) return
  const { kind, data } = env.payload || {}
  await trx('acc_proj')
    .insert({ aggregate_id: env.aggregateId, version: env.aggregateVersion, deleted: kind === 'deleted', data: kind === 'deleted' ? null : data })
    .onConflict('aggregate_id')
    .merge()
}
export async function projState(db: Knex): Promise<Record<string, any>> {
  const rows = await db('acc_proj')
  return Object.fromEntries(rows.map((r: any) => [r.aggregate_id, { version: Number(r.version), deleted: r.deleted, data: r.data }]))
}
export const SENTINEL_AGG = () => typeId('org')
