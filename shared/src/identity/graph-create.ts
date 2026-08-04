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

import { EntityId, IdentityError } from './brand'
import { mintId } from './id'
import { EntityType, isEntityType } from './registry'

/** Reference token: `lid:<local>`. */
const LID_REF = /^lid:(.+)$/

/**
 * Permitted shape of a local id, matching the `LocalId` schema published in the
 * contract (1-64 chars). Enforced here because `lid` values are echoed back to
 * the caller as `idMap` KEYS — the one place client-controlled text crosses into
 * a response — and because a contract that declares a bound the implementation
 * does not enforce is not a bound at all.
 */
const LID_FORMAT = /^[A-Za-z0-9_.:-]{1,64}$/

export interface GraphCreateOptions {
  /**
   * Entity types this service OWNS. A `lid` node declaring anything else is
   * rejected: a lid graph is scoped to one service's aggregate boundary,
   * because a graph spanning services cannot be created atomically — there is
   * no distributed transaction. Cross-service references must be real,
   * already-existing ids. See governance/identifier-standard.md 4.
   */
  aggregate: ReadonlySet<EntityType> | readonly EntityType[]
  /** Node-count ceiling; an unbounded graph is a cheap amplification vector. */
  maxNodes?: number
  /** Nesting ceiling, guarding against deep or cyclic input structures. */
  maxDepth?: number
}

export interface GraphCreateResult {
  /** The body with every `lid` resolved to a minted id and `lid` removed. */
  body: unknown
  /** local id -> minted entity id, for every first-class entity created. */
  idMap: Record<string, string>
}

export type GraphErrorCode =
  | 'CLIENT_SUPPLIED_ID'
  | 'UNKNOWN_LID'
  | 'DUPLICATE_LID'
  | 'MALFORMED_LID'
  | 'MISSING_TYPE'
  | 'UNKNOWN_TYPE'
  | 'CROSS_AGGREGATE_LID'
  | 'GRAPH_TOO_LARGE'
  | 'GRAPH_TOO_DEEP'

export class GraphCreateError extends Error {
  readonly code: GraphErrorCode
  /** JSON-pointer-ish path to the offending node, for actionable 422s. */
  readonly path: string

  constructor(code: GraphErrorCode, path: string, message: string) {
    super(message)
    this.name = 'GraphCreateError'
    this.code = code
    this.path = path
  }
}

const DEFAULT_MAX_NODES = 500
const DEFAULT_MAX_DEPTH = 32

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
export function resolveGraph(body: unknown, options: GraphCreateOptions): GraphCreateResult {
  const aggregate =
    options.aggregate instanceof Set ? options.aggregate : new Set(options.aggregate)
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  // Pass 1 — validate, and mint an id for every lid node. Minting up front is
  // what makes reference cycles resolvable in pass 2.
  const idMap: Record<string, string> = {}
  let nodeCount = 0

  const collect = (value: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) {
      throw new GraphCreateError('GRAPH_TOO_DEEP', path, `graph exceeds ${maxDepth} levels`)
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => collect(item, `${path}/${i}`, depth + 1))
      return
    }
    if (!isPlainObject(value)) return

    if ('id' in value) {
      throw new GraphCreateError(
        'CLIENT_SUPPLIED_ID',
        path,
        'ids are minted by the owning service and must not be supplied on create'
      )
    }

    if ('lid' in value) {
      const lid = value.lid
      if (typeof lid !== 'string' || !LID_FORMAT.test(lid)) {
        throw new GraphCreateError(
          'MALFORMED_LID',
          path,
          'lid must be 1-64 characters of [A-Za-z0-9_.:-]'
        )
      }
      if (Object.prototype.hasOwnProperty.call(idMap, lid)) {
        throw new GraphCreateError('DUPLICATE_LID', path, `lid ${JSON.stringify(lid)} is declared twice`)
      }
      if (++nodeCount > maxNodes) {
        throw new GraphCreateError('GRAPH_TOO_LARGE', path, `graph exceeds ${maxNodes} nodes`)
      }

      const type = value.type
      if (typeof type !== 'string') {
        throw new GraphCreateError('MISSING_TYPE', path, 'a lid node must declare its entity type')
      }
      if (!isEntityType(type)) {
        throw new GraphCreateError('UNKNOWN_TYPE', path, `unregistered entity type ${JSON.stringify(type)}`)
      }
      if (!aggregate.has(type)) {
        throw new GraphCreateError(
          'CROSS_AGGREGATE_LID',
          path,
          `${type} is owned by another service; reference it by its existing id instead of creating it here`
        )
      }

      idMap[lid] = mintId(type)
    }

    for (const [key, child] of Object.entries(value)) {
      collect(child, `${path}/${key}`, depth + 1)
    }
  }

  collect(body, '', 0)

  // Pass 2 — rewrite. Every id already exists, so order does not matter and
  // mutual references resolve without a second write.
  const rewrite = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, i) => rewrite(item, `${path}/${i}`))
    if (typeof value === 'string') {
      const match = LID_REF.exec(value)
      if (!match) return value
      const target = match[1]
      const resolved = idMap[target]
      if (!resolved) {
        throw new GraphCreateError(
          'UNKNOWN_LID',
          path,
          `reference to undeclared lid ${JSON.stringify(target)}`
        )
      }
      return resolved
    }
    if (!isPlainObject(value)) return value

    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'lid') continue // document-scoped; never persisted
      out[key] = rewrite(child, `${path}/${key}`)
    }
    if (typeof value.lid === 'string') {
      // The server-minted id, injected where the handler expects to find it.
      out.id = idMap[value.lid]
    }
    return out
  }

  return { body: rewrite(body, ''), idMap }
}

// ---------------------------------------------------------------------------
// Express adapter
// ---------------------------------------------------------------------------

// Typed structurally rather than against @types/express on purpose: this repo
// pins @types/express inconsistently across workspaces (4.17.21 and ^5.0.0 both
// appear), and a hard dependency here would drag that conflict into every
// consumer. These shapes are satisfied by Express 4 and 5 alike.
export interface GraphRequestLike {
  method: string
  body?: unknown
}

export interface GraphResponseLike {
  locals: Record<string, unknown>
  status(code: number): GraphResponseLike
  json(payload: unknown): unknown
}

export type GraphNext = (err?: unknown) => void

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Express middleware wrapping `resolveGraph`.
 *
 * Mount it ahead of the create routes. Handlers downstream see a body whose
 * ids are already minted and whose references are already resolved, and the
 * `idMap` is merged into the JSON response automatically — so a route opts in
 * to graph create by doing nothing at all.
 */
export function graphCreate(options: GraphCreateOptions) {
  return function graphCreateMiddleware(
    req: GraphRequestLike,
    res: GraphResponseLike,
    next: GraphNext
  ): void {
    if (!MUTATING_METHODS.has(req.method.toUpperCase()) || req.body === undefined) {
      next()
      return
    }

    let result: GraphCreateResult
    try {
      result = resolveGraph(req.body, options)
    } catch (err) {
      if (err instanceof GraphCreateError || err instanceof IdentityError) {
        res.status(422).json({
          error: 'unprocessable_entity',
          code: err.code,
          message: err.message,
          // Always present for a graph error, including the empty string that
          // denotes the document root — an omitted path reads as "location
          // unknown", which is exactly wrong for the root-level case.
          ...(err instanceof GraphCreateError ? { path: err.path } : {}),
        })
        return
      }
      next(err)
      return
    }

    req.body = result.body
    res.locals.idMap = result.idMap

    if (Object.keys(result.idMap).length > 0) {
      const originalJson = res.json.bind(res)
      res.json = (payload: unknown): unknown => {
        // Only decorate object payloads, and never clobber a handler that has
        // already produced its own idMap.
        if (isPlainObject(payload) && !('idMap' in payload)) {
          return originalJson({ ...payload, idMap: result.idMap })
        }
        return originalJson(payload)
      }
    }

    next()
  }
}

/** The minted ids for a request, for handlers that need them directly. */
export function idMapOf(res: GraphResponseLike): Record<string, string> {
  return (res.locals.idMap as Record<string, string> | undefined) ?? {}
}

/** Re-exported so consumers can type an id column without a second import. */
export type { EntityId }
