"use strict";
// Graph create: `lid` in, `idMap` out.
//
// The problem: once clients stop supplying ids, a frontend building a customer
// plus its orders in one request can no longer express "this order belongs to
// THAT customer I am creating right now", and cannot learn the real ids on
// return.
//
// The shape: each node carries a document-scoped local id (`lid`) and
// references it as `"lid:<local>"`. Standardised prior art, not invention —
// JSON:API 1.1 `lid`, SCIM `bulkId` (RFC 7644 3.7.2), OData $batch Content-ID.
// Deliberately NOT the `id` field: putting a placeholder there would put `id`
// back in create bodies and degrade the rule to "id must be present but fake",
// which is unenforceable. `id` is never accepted, full stop.
//
// The trick: every id is minted UP FRONT, before any handler runs, and
// substituted into the body. Three consequences —
//   1. handlers receive a plain body with real ids and never learn `lid`
//      existed, so no route implements any of this;
//   2. `idMap` is just the allocation table, so nothing rewrites on the way out;
//   3. cycles resolve. A -> B and B -> A is unsolvable by post-substitution
//      (it needs a deferred UPDATE); with pre-allocation both ids exist before
//      either row is written.
//
// Policy: governance/identifier-standard.md 3-4.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphCreateError = void 0;
exports.resolveGraph = resolveGraph;
exports.graphCreate = graphCreate;
exports.idMapOf = idMapOf;
const brand_1 = require("./brand");
const id_1 = require("./id");
const registry_1 = require("./registry");
/** Reference token: `lid:<local>`. */
const LID_REF = /^lid:(.+)$/;
class GraphCreateError extends Error {
    constructor(code, path, message) {
        super(message);
        this.name = 'GraphCreateError';
        this.code = code;
        this.path = path;
    }
}
exports.GraphCreateError = GraphCreateError;
const DEFAULT_MAX_NODES = 500;
const DEFAULT_MAX_DEPTH = 32;
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Resolves a create-graph: validates it, mints an id per `lid` node, and
 * rewrites every `lid:` reference to the minted id.
 *
 * Framework-agnostic on purpose — the Express adapter below is a thin shell, so
 * this stays unit-testable without spinning up a server.
 *
 * Mutates nothing: returns a rewritten copy.
 */
function resolveGraph(body, options) {
    var _a, _b;
    const aggregate = options.aggregate instanceof Set ? options.aggregate : new Set(options.aggregate);
    const maxNodes = (_a = options.maxNodes) !== null && _a !== void 0 ? _a : DEFAULT_MAX_NODES;
    const maxDepth = (_b = options.maxDepth) !== null && _b !== void 0 ? _b : DEFAULT_MAX_DEPTH;
    // Pass 1 — validate, and mint an id for every lid node. Minting up front is
    // what makes reference cycles resolvable in pass 2.
    const idMap = {};
    let nodeCount = 0;
    const collect = (value, path, depth) => {
        if (depth > maxDepth) {
            throw new GraphCreateError('GRAPH_TOO_DEEP', path, `graph exceeds ${maxDepth} levels`);
        }
        if (Array.isArray(value)) {
            value.forEach((item, i) => collect(item, `${path}/${i}`, depth + 1));
            return;
        }
        if (!isPlainObject(value))
            return;
        if ('id' in value) {
            throw new GraphCreateError('CLIENT_SUPPLIED_ID', path, 'ids are minted by the owning service and must not be supplied on create');
        }
        if ('lid' in value) {
            const lid = value.lid;
            if (typeof lid !== 'string' || lid.length === 0) {
                throw new GraphCreateError('MALFORMED_LID', path, 'lid must be a non-empty string');
            }
            if (Object.prototype.hasOwnProperty.call(idMap, lid)) {
                throw new GraphCreateError('DUPLICATE_LID', path, `lid ${JSON.stringify(lid)} is declared twice`);
            }
            if (++nodeCount > maxNodes) {
                throw new GraphCreateError('GRAPH_TOO_LARGE', path, `graph exceeds ${maxNodes} nodes`);
            }
            const type = value.type;
            if (typeof type !== 'string') {
                throw new GraphCreateError('MISSING_TYPE', path, 'a lid node must declare its entity type');
            }
            if (!(0, registry_1.isEntityType)(type)) {
                throw new GraphCreateError('UNKNOWN_TYPE', path, `unregistered entity type ${JSON.stringify(type)}`);
            }
            if (!aggregate.has(type)) {
                throw new GraphCreateError('CROSS_AGGREGATE_LID', path, `${type} is owned by another service; reference it by its existing id instead of creating it here`);
            }
            idMap[lid] = (0, id_1.mintId)(type);
        }
        for (const [key, child] of Object.entries(value)) {
            collect(child, `${path}/${key}`, depth + 1);
        }
    };
    collect(body, '', 0);
    // Pass 2 — rewrite. Every id already exists, so order does not matter and
    // mutual references resolve without a second write.
    const rewrite = (value, path) => {
        if (Array.isArray(value))
            return value.map((item, i) => rewrite(item, `${path}/${i}`));
        if (typeof value === 'string') {
            const match = LID_REF.exec(value);
            if (!match)
                return value;
            const target = match[1];
            const resolved = idMap[target];
            if (!resolved) {
                throw new GraphCreateError('UNKNOWN_LID', path, `reference to undeclared lid ${JSON.stringify(target)}`);
            }
            return resolved;
        }
        if (!isPlainObject(value))
            return value;
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (key === 'lid')
                continue; // document-scoped; never persisted
            out[key] = rewrite(child, `${path}/${key}`);
        }
        if (typeof value.lid === 'string') {
            // The server-minted id, injected where the handler expects to find it.
            out.id = idMap[value.lid];
        }
        return out;
    };
    return { body: rewrite(body, ''), idMap };
}
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);
/**
 * Express middleware wrapping `resolveGraph`.
 *
 * Mount it ahead of the create routes. Handlers downstream see a body whose
 * ids are already minted and whose references are already resolved, and the
 * `idMap` is merged into the JSON response automatically — so a route opts in
 * to graph create by doing nothing at all.
 */
function graphCreate(options) {
    return function graphCreateMiddleware(req, res, next) {
        if (!MUTATING_METHODS.has(req.method.toUpperCase()) || req.body === undefined) {
            next();
            return;
        }
        let result;
        try {
            result = resolveGraph(req.body, options);
        }
        catch (err) {
            if (err instanceof GraphCreateError || err instanceof brand_1.IdentityError) {
                res.status(422).json(Object.assign({ error: 'unprocessable_entity', code: err.code, message: err.message }, (err instanceof GraphCreateError ? { path: err.path } : {})));
                return;
            }
            next(err);
            return;
        }
        req.body = result.body;
        res.locals.idMap = result.idMap;
        if (Object.keys(result.idMap).length > 0) {
            const originalJson = res.json.bind(res);
            res.json = (payload) => {
                // Only decorate object payloads, and never clobber a handler that has
                // already produced its own idMap.
                if (isPlainObject(payload) && !('idMap' in payload)) {
                    return originalJson(Object.assign(Object.assign({}, payload), { idMap: result.idMap }));
                }
                return originalJson(payload);
            };
        }
        next();
    };
}
/** The minted ids for a request, for handlers that need them directly. */
function idMapOf(res) {
    var _a;
    return (_a = res.locals.idMap) !== null && _a !== void 0 ? _a : {};
}
