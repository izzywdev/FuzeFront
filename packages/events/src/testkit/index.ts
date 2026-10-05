// @izzywdev/fuzefront-events/testkit — deterministic doubles + delivery-chaos helpers.
// Everything here is in-memory and synchronous-ish; no broker, no database.
import type {
  EachMessageLike,
  InboxStore,
  InboxTx,
  KafkaConsumerLike,
  KafkaLike,
  KafkaProducerLike,
} from '../consumer'
import type { SqlClient } from '../db'
import type { ClaimOps, OutboxRow, OutboxStore } from '../relay'

// ---------------------------------------------------------------------------
// Chaos helpers
// ---------------------------------------------------------------------------

/** Each item repeated `times` times, consecutively (at-least-once delivery). Default 2. */
export function duplicate<T>(items: readonly T[], times = 2): T[] {
  const out: T[] = []
  for (const it of items) for (let i = 0; i < times; i++) out.push(it)
  return out
}

/** mulberry32: tiny deterministic PRNG so a failing shuffle is reproducible from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic Fisher-Yates shuffle (returns a new array; same seed => same order). */
export function shuffle<T>(items: readonly T[], seed = 1): T[] {
  const a = items.slice()
  const r = rng(seed)
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Rewind a consumer group on a topic so already-delivered messages are delivered again (a "replay"). */
export function replay(broker: InMemoryKafka, groupId: string, topic: string, fromOffset = 0): void {
  broker.seek(groupId, topic, fromOffset)
}

// ---------------------------------------------------------------------------
// In-memory Kafka double
// ---------------------------------------------------------------------------
interface StoredMessage {
  key: Buffer | null
  value: Buffer
  offset: string
}

function hashKey(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface Group {
  topics: Map<string, boolean>
  handler?: (p: EachMessageLike) => Promise<void>
  /** next offset to deliver per `${topic}:${partition}` */
  next: Map<string, number>
}

/**
 * Minimal Kafka: partitioned append-only topics (key hash => partition, so per-key order holds),
 * consumer groups with committed offsets, redelivery of a message whose handler threw (the
 * partition stalls on it until the next `drain()`, like kafkajs retrying), and seek/replay.
 * Satisfies `KafkaLike` so it plugs into `createConsumer({ kafka })`.
 */
export class InMemoryKafka implements KafkaLike {
  private topics = new Map<string, StoredMessage[][]>()
  private groups = new Map<string, Group>()
  /** Errors thrown by handlers during `drain()`, in order. */
  readonly errors: Error[] = []
  /** When set, `send` calls throw this error while it returns true (broker outage simulation). */
  sendFailure: ((topic: string) => Error | undefined) | undefined

  constructor(private readonly partitionsPerTopic = 1) {}

  private partitionsOf(topic: string): StoredMessage[][] {
    let p = this.topics.get(topic)
    if (!p) {
      p = Array.from({ length: this.partitionsPerTopic }, () => [])
      this.topics.set(topic, p)
    }
    return p
  }

  /** Append a raw message (what a producer `send` does). Returns [partition, offset]. */
  produce(topic: string, value: string | Buffer, key?: string): [number, string] {
    const parts = this.partitionsOf(topic)
    const partition = key === undefined ? 0 : hashKey(key) % parts.length
    const offset = String(parts[partition].length)
    parts[partition].push({
      key: key === undefined ? null : Buffer.from(key),
      value: Buffer.isBuffer(value) ? value : Buffer.from(value),
      offset,
    })
    return [partition, offset]
  }

  /** All messages of a topic as `{key, value(string), partition, offset}` (parse `value` yourself). */
  messages(topic: string): Array<{ key: string | null; value: string; partition: number; offset: string }> {
    return this.partitionsOf(topic).flatMap((msgs, partition) =>
      msgs.map((m) => ({ key: m.key?.toString() ?? null, value: m.value.toString(), partition, offset: m.offset }))
    )
  }

  /** Parsed JSON values of a topic. */
  json<T = unknown>(topic: string): T[] {
    return this.messages(topic).map((m) => JSON.parse(m.value) as T)
  }

  seek(groupId: string, topic: string, offset: number): void {
    const g = this.groups.get(groupId)
    if (!g) throw new Error(`unknown consumer group ${groupId}`)
    for (let p = 0; p < this.partitionsOf(topic).length; p++) g.next.set(`${topic}:${p}`, offset)
  }

  producer(): KafkaProducerLike {
    return {
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async ({ topic, messages }) => {
        const err = this.sendFailure?.(topic)
        if (err) throw err
        for (const m of messages) this.produce(topic, m.value, m.key)
      },
    }
  }

  consumer({ groupId }: { groupId: string }): KafkaConsumerLike {
    const group: Group = this.groups.get(groupId) ?? { topics: new Map(), next: new Map() }
    this.groups.set(groupId, group)
    return {
      connect: async () => undefined,
      disconnect: async () => undefined,
      subscribe: async ({ topic, fromBeginning }) => {
        group.topics.set(topic, fromBeginning ?? false)
      },
      run: async ({ eachMessage }) => {
        group.handler = eachMessage
      },
    }
  }

  /**
   * Deliver everything undelivered to every running group, partition by partition, in order.
   * A handler that throws stalls its partition at that message (offset not committed); call
   * `drain()` again to redeliver it. Returns the number of messages successfully handled.
   */
  async drain(): Promise<number> {
    let handled = 0
    for (const group of this.groups.values()) {
      if (!group.handler) continue
      for (const topic of group.topics.keys()) {
        const parts = this.partitionsOf(topic)
        for (let p = 0; p < parts.length; p++) {
          const k = `${topic}:${p}`
          if (!group.next.has(k)) group.next.set(k, 0)
          while ((group.next.get(k) as number) < parts[p].length) {
            const m = parts[p][group.next.get(k) as number]
            try {
              await group.handler({ topic, partition: p, message: { key: m.key, value: m.value, offset: m.offset } })
            } catch (err) {
              this.errors.push(err instanceof Error ? err : new Error(String(err)))
              break
            }
            group.next.set(k, (group.next.get(k) as number) + 1)
            handled++
          }
        }
      }
    }
    return handled
  }
}

// ---------------------------------------------------------------------------
// In-memory outbox store (same claim semantics as pgOutboxStore)
// ---------------------------------------------------------------------------
export interface MemoryOutboxRow extends OutboxRow {
  status: 'pending' | 'sent' | 'failed'
  lastError: string | null
}

export class MemoryOutboxStore implements OutboxStore {
  readonly rows: MemoryOutboxRow[] = []

  /** Insert a row like `enqueueEvent` would (from an envelope-shaped object). */
  enqueue(e: {
    eventId: string
    topic: string
    payload: unknown
    aggregateType: string
    aggregateId: string
    aggregateVersion: number
    producer: string
    correlationId: string
    causationId?: string
    schemaVersion: number
    occurredAt: string
  }): void {
    if (this.rows.some((r) => r.eventId === e.eventId)) throw new Error('duplicate event_id')
    if (
      this.rows.some(
        (r) =>
          r.aggregateType === e.aggregateType &&
          r.aggregateId === e.aggregateId &&
          r.aggregateVersion === e.aggregateVersion
      )
    ) {
      throw new Error('duplicate (aggregate_type, aggregate_id, aggregate_version)')
    }
    this.rows.push({
      id: `row-${this.rows.length + 1}`,
      eventId: e.eventId,
      topic: e.topic,
      payload: e.payload,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      aggregateVersion: e.aggregateVersion,
      producer: e.producer,
      correlationId: e.correlationId,
      causationId: e.causationId ?? null,
      schemaVersion: e.schemaVersion,
      attempts: 0,
      occurredAt: e.occurredAt,
      status: 'pending',
      lastError: null,
    })
  }

  status(eventId: string): MemoryOutboxRow['status'] | undefined {
    return this.rows.find((r) => r.eventId === eventId)?.status
  }

  async claim<T>(batchSize: number, fn: (rows: OutboxRow[], ops: ClaimOps) => Promise<T>): Promise<T> {
    const claimable = this.rows
      .filter((r) => r.status === 'pending')
      .filter(
        (r) =>
          !this.rows.some(
            (p) =>
              p.aggregateType === r.aggregateType &&
              p.aggregateId === r.aggregateId &&
              p.aggregateVersion < r.aggregateVersion &&
              (p.status === 'pending' || p.status === 'failed')
          )
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.aggregateVersion - b.aggregateVersion)
      .slice(0, batchSize)
    const find = (row: OutboxRow): MemoryOutboxRow => this.rows.find((r) => r.id === row.id) as MemoryOutboxRow
    const ops: ClaimOps = {
      markSent: async (row) => {
        const r = find(row)
        r.status = 'sent'
        r.attempts++
      },
      markRetry: async (row, error) => {
        const r = find(row)
        r.attempts++
        r.lastError = error
      },
      markFailed: async (row, error) => {
        const r = find(row)
        r.status = 'failed'
        r.attempts++
        r.lastError = error
      },
    }
    return fn(
      claimable.map((r) => ({ ...r })),
      ops
    )
  }
}

// ---------------------------------------------------------------------------
// In-memory inbox store (transactional: a throwing callback rolls its writes back)
// ---------------------------------------------------------------------------
const noSql: SqlClient = {
  async query() {
    throw new Error('MemoryInboxStore has no SQL; keep handler state in memory or use a real Postgres inbox')
  },
}

export class MemoryInboxStore implements InboxStore {
  processed = new Set<string>()

  async transaction<T>(fn: (tx: InboxTx) => Promise<T>): Promise<T> {
    const snap = new Set(this.processed)
    try {
      return await fn({
        sql: noSql,
        markProcessed: async (consumer, eventId) => {
          const k = `${consumer}\u0000${eventId}`
          if (this.processed.has(k)) return false
          this.processed.add(k)
          return true
        },
      })
    } catch (err) {
      this.processed = snap
      throw err
    }
  }
}

/**
 * Reference projection implementing packages/conformance-vectors/events/version-guard.json:
 * per aggregateId it keeps {version, deleted, data}; an event applies iff `aggregateVersion` is
 * STRICTLY greater than the stored version; `deleted` sets deleted=true, data=null and KEEPS the
 * version (tombstone), so a late lower-version event can never resurrect it.
 * Wire `getStoredVersion` into `createConsumer` and call `apply` from the handler.
 */
export class ProjectionGuard<D = unknown> {
  readonly state = new Map<string, { version: number; deleted: boolean; data: D | null }>()

  /** The optional `getStoredVersion` hook for `createConsumer` (version 0 / null = no row). */
  getStoredVersion = async (e: { aggregateId?: string }): Promise<number | null> =>
    this.state.get(e.aggregateId as string)?.version ?? null

  /** Apply per the guard; returns whether the event changed state. */
  apply(e: { aggregateId: string; aggregateVersion: number }, kind: 'created' | 'updated' | 'deleted', data?: D): 'applied' | 'ignored' {
    const cur = this.state.get(e.aggregateId)
    if (cur && e.aggregateVersion <= cur.version) return 'ignored'
    this.state.set(
      e.aggregateId,
      kind === 'deleted'
        ? { version: e.aggregateVersion, deleted: true, data: null }
        : { version: e.aggregateVersion, deleted: false, data: (data ?? null) as D | null }
    )
    return 'applied'
  }
}
