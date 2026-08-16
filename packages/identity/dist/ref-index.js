"use strict";
// L1 referential integrity — a local projection of "does this entity exist",
// fed by the events the owning service already publishes.
//
// Orders and customers live in different services and different databases, so
// there is no foreign key to lean on (governance/identifier-standard.md §5).
// Integrity is layered instead, and this file is L1:
//
//   L0  assertRef('customer', id)      prefix compare, offline  → is it the right KIND
//   L1  assertRefExists(store, …)      local indexed lookup     → does it EXIST
//   L2  verify-on-write RPC            per-reference opt-in     → is it exist RIGHT NOW
//   L3  async reconciler                background              → whatever the above missed
//
// L1 rather than an RPC as the default because a local read has no
// cache-invalidation problem and keeps working when the owning service is down.
// It is a projection, so it is EVENTUALLY consistent — and that is the whole
// design problem here, addressed by `staleAfterMs` below rather than ignored.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REF_INDEX_TOPICS = exports.TOPIC_PROJECTIONS = exports.RefIndexError = void 0;
exports.assertRefExists = assertRefExists;
exports.applyEventToRefIndex = applyEventToRefIndex;
const id_1 = require("./id");
const codec_1 = require("./codec");
class RefIndexError extends Error {
    constructor(code, entityType, entityId) {
        super(code === 'REF_DELETED'
            ? `${entityType} ${entityId} has been deleted`
            : `no such ${entityType}: ${entityId}`);
        this.name = 'RefIndexError';
        this.code = code;
        this.entityType = entityType;
        this.entityId = entityId;
    }
}
exports.RefIndexError = RefIndexError;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
/**
 * L0 then L1: the reference is the right KIND of thing, and it EXISTS —
 * both answered without a network call, a cache, or the owning service being up.
 *
 * Returns the branded id, so this composes into a repository call the same way
 * `assertRef` does.
 */
async function assertRefExists(store, entityType, raw, options = {}) {
    // L0 first, always. It is a string compare and it is the only check that
    // answers "is this the right kind of thing" — a `cus_` id arriving where an
    // `inv_` belongs is rejected here whatever the projection says.
    const id = (0, id_1.assertRef)(entityType, raw);
    const { mode = 'warn', staleAfterMs = DEFAULT_STALE_AFTER_MS, tenantId = null, onWarn = (message) => console.warn(message), now = () => new Date(), } = options;
    const exists = await store.has(entityType, storageForm(id), tenantId);
    if (exists)
        return id;
    if (mode === 'enforce' && staleAfterMs !== null) {
        const lastApplied = await store.lastAppliedAt();
        const lagMs = lastApplied === null ? Infinity : now().getTime() - lastApplied.getTime();
        if (lagMs > staleAfterMs) {
            onWarn(`[ref-index] projection is stale (${lastApplied === null ? 'never applied an event' : `${Math.round(lagMs / 1000)}s behind`}); allowing unverified reference ${entityType}=${raw} rather than failing writes ` +
                `while the projection catches up`);
            return id;
        }
    }
    if (mode === 'enforce')
        throw new RefIndexError('REF_NOT_FOUND', entityType, raw);
    onWarn(`[ref-index] unknown reference ${entityType}=${raw} (advisory; mode=warn)`);
    return id;
}
/**
 * The storage form of a wire id — the bare uuid the projection keys on.
 *
 * The projection is fed by events carrying bare uuids (every `identity.*`
 * schema declares `z.string().uuid()`), while callers pass WIRE ids. Keying the
 * table on storage form is what lets one projection serve both, and it matches
 * §2: prefix on the wire, native uuid in the column.
 */
function storageForm(id) {
    // A value that is ALREADY a bare uuid is the legacy case a dual-accept window
    // exists for (§8), and `toUuid` rejects it — so fall through rather than
    // failing the lookup on exactly the rows the migration has not reached yet.
    if ((0, codec_1.isUuid)(id))
        return id;
    try {
        return (0, id_1.toUuid)(id);
    }
    catch {
        return id;
    }
}
/**
 * The lifecycle events already published on FuzeFront topics, mapped to the
 * projection. Nothing new has to be emitted for L1 to work — that is the point
 * of building on `identity.*` rather than inventing a parallel stream: an event
 * contract that only the integrity layer consumes is one nobody maintains.
 */
// Field names are taken from the shipped Zod schemas in shared/src/kafka/schemas,
// not from the topic name — `identity.org.*` carries `organizationId`, not `orgId`.
//
// `app.registered` is deliberately ABSENT: its payload
// (shared/src/kafka/schemas/app.registered.ts) carries slug/name/organizationId
// but no app id at all, so there is nothing to project. Adding an id to that
// event is its own change with its own consumers; claiming app coverage here
// without one would put a lookup in the code path that can never succeed.
exports.TOPIC_PROJECTIONS = Object.freeze({
    'identity.user.created': { entityType: 'user', operation: 'upsert', idField: 'userId' },
    'identity.user.deleted': { entityType: 'user', operation: 'delete', idField: 'userId' },
    'identity.org.created': {
        entityType: 'organization',
        operation: 'upsert',
        idField: 'organizationId',
    },
    'identity.org.deleted': {
        entityType: 'organization',
        operation: 'delete',
        idField: 'organizationId',
    },
    'portal.created': {
        entityType: 'portal',
        operation: 'upsert',
        idField: 'portalId',
        tenantField: 'organizationId',
    },
});
/** Every topic a service must subscribe to in order to keep the projection current. */
exports.REF_INDEX_TOPICS = Object.freeze(Object.keys(exports.TOPIC_PROJECTIONS));
/**
 * Applies one event to the projection. Pure routing — the store does the I/O,
 * so this is unit-testable with an in-memory store and no broker.
 *
 * Unmapped topics and payloads missing their id field are IGNORED rather than
 * thrown: a consumer that dies on an unexpected message stops projecting
 * everything, which is a far worse outcome than one skipped row.
 */
async function applyEventToRefIndex(store, topic, payload) {
    const projection = exports.TOPIC_PROJECTIONS[topic];
    if (!projection)
        return false;
    const entityId = payload[projection.idField];
    if (typeof entityId !== 'string' || entityId.length === 0)
        return false;
    const tenantRaw = projection.tenantField ? payload[projection.tenantField] : null;
    const tenantId = typeof tenantRaw === 'string' ? tenantRaw : null;
    if (projection.operation === 'delete') {
        await store.markDeleted(projection.entityType, entityId, tenantId);
    }
    else {
        await store.upsert({
            entityType: projection.entityType,
            entityId,
            tenantId,
            status: 'active',
        });
    }
    return true;
}
