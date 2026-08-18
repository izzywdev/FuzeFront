"use strict";
// The single source of truth mapping an entity type to its wire prefix.
//
// The prefix is what makes the cross-type collision attack structurally
// impossible: no string is simultaneously a valid `cus_…` and a valid `ord_…`,
// so a reference that arrives at the wrong endpoint is rejected by a string
// compare — no network call, no cache, no database. In a microservices split
// there is no shared unique index to lean on, so this check is the only
// defense that works offline. See governance/identifier-standard.md §2.
//
// Adding a type here is the ONLY way to mint ids for it. Prefixes are
// permanent once shipped: changing one is a wire-breaking change for every
// stored reference (Stripe re-prefixed invoice line items to `il_` and broke
// exactly the integrators who had parsed the old form).
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTITY_TYPES = exports.ENTITY_PREFIXES = void 0;
exports.prefixFor = prefixFor;
exports.typeForPrefix = typeForPrefix;
exports.isEntityType = isEntityType;
/** Wire prefixes, keyed by entity type. Prefix must match `^[a-z][a-z_]{1,62}$`. */
exports.ENTITY_PREFIXES = {
    // platform
    portal: 'prt',
    organization: 'org',
    user: 'usr',
    app: 'app',
    // billing
    customer: 'cus',
    subscription: 'sub',
    payment: 'pay',
    invoice: 'inv',
    credit: 'crd',
    // identity — the remaining spine entities the FFRNT-185 rollout mints.
    // Registered ahead of the call sites so the migration is a per-site edit
    // rather than a registry change per service. `ivt` not `inv`: invoice already
    // owns `inv`, and a prefix collision inside one registry would defeat the
    // whole point of the prefix.
    invitation: 'ivt',
    membership: 'mbr',
    session: 'ses',
    mfaFactor: 'mfa',
    // messaging
    conversation: 'cnv',
    message: 'msg',
    notification: 'ntf',
};
/** Reverse index, built once. Used to name the type in error messages. */
const TYPE_BY_PREFIX = Object.freeze(Object.fromEntries(Object.entries(exports.ENTITY_PREFIXES).map(([type, prefix]) => [prefix, type])));
function prefixFor(type) {
    return exports.ENTITY_PREFIXES[type];
}
/** The entity type owning `prefix`, or null when the prefix is unregistered. */
function typeForPrefix(prefix) {
    return TYPE_BY_PREFIX[prefix] ?? null;
}
function isEntityType(value) {
    return Object.prototype.hasOwnProperty.call(exports.ENTITY_PREFIXES, value);
}
/** Every registered type, for gates and tests that need to enumerate. */
exports.ENTITY_TYPES = Object.keys(exports.ENTITY_PREFIXES);
