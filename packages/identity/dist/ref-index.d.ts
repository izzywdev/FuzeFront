import type { EntityType } from './registry';
import type { EntityId } from './brand';
/** One row of the projection. `tenantId` scopes it where the source event carries one. */
export interface RefRecord {
    entityType: EntityType;
    /** The entity's id in storage form (a bare uuid), NOT the wire form. */
    entityId: string;
    tenantId?: string | null;
    status: 'active' | 'deleted';
}
/**
 * The storage a service provides. Deliberately tiny and DB-agnostic: this
 * package must not take a `pg` dependency — Python services and non-Postgres
 * services consume the same standard.
 */
export interface RefIndexStore {
    /** True when an ACTIVE row exists for this (type, id[, tenant]). */
    has(entityType: EntityType, entityId: string, tenantId?: string | null): Promise<boolean>;
    /** Idempotent upsert — consumers redeliver, so this is called more than once per event. */
    upsert(record: RefRecord): Promise<void>;
    /** Tombstone rather than DELETE, so a redelivered `*.created` cannot resurrect a dead row. */
    markDeleted(entityType: EntityType, entityId: string, tenantId?: string | null): Promise<void>;
    /**
     * When the projection last applied an event, or null if it never has.
     * This is what makes enforcement safe to switch on; see `staleAfterMs`.
     */
    lastAppliedAt(): Promise<Date | null>;
    /** True when the projection holds no rows — the signal to rebuild from the log. */
    isEmpty(): Promise<boolean>;
}
export declare class RefIndexError extends Error {
    readonly code: 'REF_NOT_FOUND' | 'REF_DELETED';
    readonly entityType: EntityType;
    readonly entityId: string;
    constructor(code: RefIndexError['code'], entityType: EntityType, entityId: string);
}
export interface AssertRefExistsOptions {
    /**
     * `enforce` rejects an unknown reference. `warn` reports and allows.
     *
     * Default is `warn`, and that is not timidity. A projection lags: a genuinely
     * new entity can be referenced before its `*.created` event has been consumed,
     * so enforcing everywhere converts every consumer hiccup into a user-visible
     * 4xx on VALID data. Turn `enforce` on per reference, starting with the ones
     * where a dangling reference actually costs something — the same
     * per-reference opt-in the standard specifies for L2.
     */
    mode?: 'enforce' | 'warn';
    /**
     * How stale the projection may be before `enforce` degrades to `warn`.
     *
     * Without this, a Kafka outage turns the projection into a REJECT-EVERYTHING
     * oracle: nothing new is projected, so every reference to a recent entity
     * fails, and an integrity check that is supposed to be free takes the whole
     * write path down with the message bus. Degrading is the correct failure
     * direction here precisely because L1 answers existence, not authorization —
     * an id is never a capability, so allowing an unverified reference through
     * grants nothing that the token and Permit have not already granted.
     * Default 5 minutes. `null` disables the degrade (fail closed regardless).
     */
    staleAfterMs?: number | null;
    tenantId?: string | null;
    /** Where warnings go. Defaults to `console.warn`. */
    onWarn?: (message: string) => void;
    /** Injectable clock, so the staleness path is testable without waiting. */
    now?: () => Date;
}
/**
 * L0 then L1: the reference is the right KIND of thing, and it EXISTS —
 * both answered without a network call, a cache, or the owning service being up.
 *
 * Returns the branded id, so this composes into a repository call the same way
 * `assertRef` does.
 */
export declare function assertRefExists<T extends EntityType>(store: RefIndexStore, entityType: T, raw: string, options?: AssertRefExistsOptions): Promise<EntityId<T>>;
/** How one Kafka topic updates the projection. */
export interface TopicProjection {
    entityType: EntityType;
    operation: 'upsert' | 'delete';
    /** The payload field holding the entity's id. */
    idField: string;
    /** The payload field holding the tenant/org scope, when the event carries one. */
    tenantField?: string;
}
/**
 * The lifecycle events already published on FuzeFront topics, mapped to the
 * projection. Nothing new has to be emitted for L1 to work — that is the point
 * of building on `identity.*` rather than inventing a parallel stream: an event
 * contract that only the integrity layer consumes is one nobody maintains.
 */
export declare const TOPIC_PROJECTIONS: Readonly<Record<string, TopicProjection>>;
/** Every topic a service must subscribe to in order to keep the projection current. */
export declare const REF_INDEX_TOPICS: readonly string[];
/**
 * Applies one event to the projection. Pure routing — the store does the I/O,
 * so this is unit-testable with an in-memory store and no broker.
 *
 * Unmapped topics and payloads missing their id field are IGNORED rather than
 * thrown: a consumer that dies on an unexpected message stops projecting
 * everything, which is a far worse outcome than one skipped row.
 */
export declare function applyEventToRefIndex(store: RefIndexStore, topic: string, payload: Record<string, unknown>): Promise<boolean>;
