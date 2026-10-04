/**
 * `config.changed` — cache invalidation (FF-EPIC-18-S4 / FFRNT-262).
 *
 * config-service publishes ONE `config.changed` event per committed write to a
 * `(namespace, scope)`, listing the changed key NAMES. It never carries values
 * (so secrets cannot leak through the bus): treat it purely as "re-resolve".
 *
 * This client stays dependency-free and transport-agnostic — it does not ship a
 * Kafka consumer. Subscribe with whatever your service already uses (e.g.
 * `TypedConsumer` from `@fuzefront/shared/kafka`) and hand each message to
 * {@link ConfigCache.handleEvent}:
 *
 * ```ts
 * const cache = new ConfigCache(client)
 * await consumer.subscribe(CONFIG_CHANGED_TOPIC)
 * consumer.run((event) => cache.handleEvent(event)) // event or bare payload
 * const cfg = await cache.get('fuzefront.chat', { scopeType: 'org', scopeId })
 * ```
 *
 * Events are best-effort. {@link ConfigCache} therefore ALSO revalidates by
 * version: once an entry is older than `maxAgeMs` it is re-read with
 * `If-None-Match`, so a missed event costs at most `maxAgeMs` of staleness.
 * Handle BOTH the event and the version poll — never rely on events alone.
 */

import type { ConfigClient } from './client'
import { isNotModified } from './client'
import type { EffectiveConfig, KeyName, NamespaceName, Scope, ScopeType } from './types'

/** Kafka topic config-service publishes on. Mirrors `TOPICS.CONFIG_CHANGED` in `@fuzefront/shared/kafka`. */
export const CONFIG_CHANGED_TOPIC = 'config.changed' as const

/** Payload of a `config.changed` event: key names + scope, never values. */
export interface ConfigChangedPayload {
  namespace: NamespaceName
  scope: { scopeType: ScopeType; scopeId: string | null }
  changedKeys: KeyName[]
}

/** The standard event envelope around {@link ConfigChangedPayload}. */
export interface ConfigChangedEvent {
  version: string
  topic: typeof CONFIG_CHANGED_TOPIC
  correlationId: string
  occurredAt: string
  payload: ConfigChangedPayload
}

const SCOPE_TYPES = ['platform', 'portal', 'org', 'user']

/**
 * Validate and extract a `config.changed` payload from a decoded message.
 * Accepts the full envelope or a bare payload; returns `null` for anything else.
 */
export function parseConfigChangedEvent(raw: unknown): ConfigChangedPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate =
    'payload' in raw && typeof (raw as { payload: unknown }).payload === 'object'
      ? (raw as { payload: unknown }).payload
      : raw
  const p = candidate as Partial<ConfigChangedPayload> | null
  if (!p || typeof p.namespace !== 'string' || p.namespace === '') return null
  if (!p.scope || !SCOPE_TYPES.includes(p.scope.scopeType)) return null
  if (p.scope.scopeId !== null && typeof p.scope.scopeId !== 'string') return null
  if (!Array.isArray(p.changedKeys) || !p.changedKeys.every((k) => typeof k === 'string')) return null
  return { namespace: p.namespace, scope: p.scope, changedKeys: p.changedKeys }
}

export interface ConfigCacheOptions {
  /**
   * How long an entry is served without asking the server. After this the next
   * read revalidates with `If-None-Match` (a cheap 304 when unchanged) — the
   * backstop for a missed event. Default 60s; use 0 to always revalidate.
   */
  maxAgeMs?: number
  /** Clock override for tests. */
  now?: () => number
}

interface Entry {
  config: EffectiveConfig
  fetchedAt: number
  /** Marked by an event: the next read must do a full (unconditional) fetch. */
  stale: boolean
}

function cacheKey(namespace: string, scope: Scope): string {
  return `${namespace}\u0000${scope.scopeType}\u0000${scope.scopeId ?? ''}`
}

/** A caching reader over {@link ConfigClient} that honours `config.changed`. */
export class ConfigCache {
  readonly #client: ConfigClient
  readonly #maxAgeMs: number
  readonly #now: () => number
  readonly #entries = new Map<string, Entry>()

  constructor(client: ConfigClient, options: ConfigCacheOptions = {}) {
    this.#client = client
    this.#maxAgeMs = options.maxAgeMs ?? 60_000
    this.#now = options.now ?? Date.now
  }

  /** Resolved config for a scope: cache hit, 304 revalidation, or a fresh read. */
  async get(namespace: NamespaceName, scope: Scope): Promise<EffectiveConfig> {
    const key = cacheKey(namespace, scope)
    const entry = this.#entries.get(key)

    if (entry && !entry.stale && this.#now() - entry.fetchedAt < this.#maxAgeMs) {
      return entry.config
    }

    // Stale (event-invalidated): unconditional re-resolve. Otherwise the entry
    // merely aged out: conditional read, so an unchanged view is a bodyless 304.
    const ifNoneMatch = entry && !entry.stale ? entry.config.version : undefined
    const result = await this.#client.getEffectiveConfig(namespace, scope, ifNoneMatch)

    if (isNotModified(result)) {
      // Only reachable when we sent If-None-Match, so `entry` exists.
      entry!.fetchedAt = this.#now()
      return entry!.config
    }
    this.#entries.set(key, { config: result, fetchedAt: this.#now(), stale: false })
    return result
  }

  /**
   * React to a `config.changed` message (full envelope or bare payload).
   * Returns true when a cached namespace was invalidated. Malformed messages are
   * ignored — the version poll still covers them.
   *
   * Every cached scope in the namespace is invalidated, not just the event's
   * own: a portal-scope change alters the resolved view of every org and user
   * beneath it.
   */
  handleEvent(event: unknown): boolean {
    const payload = parseConfigChangedEvent(event)
    if (!payload) return false
    return this.invalidateNamespace(payload.namespace)
  }

  /** Mark every cached scope of `namespace` stale. Returns true if any was cached. */
  invalidateNamespace(namespace: NamespaceName): boolean {
    let hit = false
    for (const [key, entry] of this.#entries) {
      if (key.startsWith(`${namespace}\u0000`)) {
        entry.stale = true
        hit = true
      }
    }
    return hit
  }

  /** Drop everything (e.g. on re-auth). */
  clear(): void {
    this.#entries.clear()
  }
}
