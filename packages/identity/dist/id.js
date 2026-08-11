"use strict";
// Mint, parse and assert entity identifiers.
//
// Wire form:    cus_01h455vb4pex5vsknk084sn02q   (what crosses the API boundary)
// Storage form: 0195a8f2-6c3d-7f11-8b2e-...      (native Postgres `uuid` column)
//
// Both render the same 128 bits; `toUuid`/`fromUuid` convert losslessly. Keep
// the wire form at the edge and the UUID in the column — see
// governance/identifier-standard.md §2.
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRef = void 0;
exports.configureIdentity = configureIdentity;
exports.getIdentityConfig = getIdentityConfig;
exports.mintId = mintId;
exports.parseId = parseId;
exports.tryParseId = tryParseId;
exports.isId = isId;
exports.toUuid = toUuid;
exports.fromUuid = fromUuid;
exports.entityTypeOf = entityTypeOf;
const codec_1 = require("./codec");
const brand_1 = require("./brand");
const registry_1 = require("./registry");
// Default: strict — no type accepts a bare UUID. Every stored row today IS a
// bare UUID, so a service adopting `parseId` on an existing surface MUST widen
// this at bootstrap for the types it has not yet backfilled. Defaulting the
// other way would mean a service silently kept accepting untyped ids simply by
// forgetting to configure anything, which is the failure mode this standard
// exists to remove.
let config = {
    legacyUuidTypes: new Set(),
};
/** Replaces identity configuration. Call once at service bootstrap. */
function configureIdentity(next) {
    config = { ...config, ...next };
}
function getIdentityConfig() {
    return config;
}
/** Splits `cus_01h4…` into its prefix and suffix; null when not that shape. */
function split(raw) {
    const separator = raw.lastIndexOf('_');
    if (separator <= 0 || separator === raw.length - 1)
        return null;
    return { prefix: raw.slice(0, separator), suffix: raw.slice(separator + 1) };
}
/** Mints a fresh, server-owned id for `type`. The ONLY id constructor. */
function mintId(type) {
    return `${(0, registry_1.prefixFor)(type)}_${(0, codec_1.encodeSuffix)((0, codec_1.uuidv7Bytes)())}`;
}
/**
 * Validates that `raw` is an id of `type` and returns it branded.
 *
 * Throws `IdentityError` on any mismatch — notably when the caller passes an
 * id belonging to a different entity type, which is the attack this standard
 * exists to stop. The check is a string compare: no network, no cache, no
 * database, and correct even when the owning service is unreachable.
 */
function parseId(type, raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
        throw new brand_1.IdentityError('MALFORMED_ID', type, `expected a ${type} id, received ${typeof raw}`);
    }
    const parts = split(raw);
    if (!parts) {
        // No prefix at all. Legitimate only for a type still inside its dual-accept
        // window; otherwise it is exactly the untyped id the standard removes.
        if ((0, codec_1.isUuid)(raw)) {
            if (config.legacyUuidTypes.has(type))
                return raw;
            throw new brand_1.IdentityError('LEGACY_NOT_PERMITTED', type, `bare UUID supplied for ${type}; prefixed ids are required for this type`);
        }
        throw new brand_1.IdentityError('MALFORMED_ID', type, `not a valid ${type} id`);
    }
    const expected = (0, registry_1.prefixFor)(type);
    if (parts.prefix !== expected) {
        const actual = (0, registry_1.typeForPrefix)(parts.prefix);
        throw new brand_1.IdentityError(actual ? 'PREFIX_MISMATCH' : 'UNKNOWN_PREFIX', type, actual
            ? `expected a ${type} id (${expected}_), received a ${actual} id (${parts.prefix}_)`
            : `expected a ${type} id (${expected}_), received unregistered prefix ${parts.prefix}_`);
    }
    if (!(0, codec_1.isValidSuffix)(parts.suffix)) {
        throw new brand_1.IdentityError('MALFORMED_ID', type, `${type} id has a malformed suffix`);
    }
    return raw;
}
/**
 * Validates a REFERENCE to an entity of `type` — the L0 check in the layered
 * referential-integrity model. Answers "is this the right kind of thing",
 * which is the only question a local check can answer without the owning
 * service. Existence is L1 (`ref_index` projection) and above.
 */
exports.assertRef = parseId;
/** Non-throwing `parseId`; returns null instead. For optional references. */
function tryParseId(type, raw) {
    try {
        return parseId(type, raw);
    }
    catch {
        return null;
    }
}
function isId(type, raw) {
    return tryParseId(type, raw) !== null;
}
/** Wire form -> storage form. Accepts a legacy bare UUID unchanged. */
function toUuid(id) {
    const parts = split(id);
    if (!parts)
        return id; // legacy bare UUID, already storage-shaped
    return (0, codec_1.bytesToUuid)((0, codec_1.decodeSuffix)(parts.suffix));
}
/** Storage form -> wire form. The inverse of `toUuid`. */
function fromUuid(type, uuid) {
    return `${(0, registry_1.prefixFor)(type)}_${(0, codec_1.encodeSuffix)((0, codec_1.uuidToBytes)(uuid))}`;
}
/**
 * The entity type `raw` declares itself to be, without knowing it in advance.
 * For generic plumbing (audit logs, tracing) — never for authorization, which
 * comes from the token and Permit policy, never from the shape of an id.
 */
function entityTypeOf(raw) {
    const parts = split(raw);
    if (!parts || !(0, codec_1.isValidSuffix)(parts.suffix))
        return null;
    return (0, registry_1.typeForPrefix)(parts.prefix);
}
