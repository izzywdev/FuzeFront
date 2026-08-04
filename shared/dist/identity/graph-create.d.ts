import { EntityId } from './brand';
import { EntityType } from './registry';
export interface GraphCreateOptions {
    /**
     * Entity types this service OWNS. A `lid` node declaring anything else is
     * rejected: a lid graph is scoped to one service's aggregate boundary,
     * because a graph spanning services cannot be created atomically — there is
     * no distributed transaction. Cross-service references must be real,
     * already-existing ids. See governance/identifier-standard.md 4.
     */
    aggregate: ReadonlySet<EntityType> | readonly EntityType[];
    /** Node-count ceiling; an unbounded graph is a cheap amplification vector. */
    maxNodes?: number;
    /** Nesting ceiling, guarding against deep or cyclic input structures. */
    maxDepth?: number;
}
export interface GraphCreateResult {
    /** The body with every `lid` resolved to a minted id and `lid` removed. */
    body: unknown;
    /** local id -> minted entity id, for every first-class entity created. */
    idMap: Record<string, string>;
}
export type GraphErrorCode = 'CLIENT_SUPPLIED_ID' | 'UNKNOWN_LID' | 'DUPLICATE_LID' | 'MALFORMED_LID' | 'MISSING_TYPE' | 'UNKNOWN_TYPE' | 'CROSS_AGGREGATE_LID' | 'GRAPH_TOO_LARGE' | 'GRAPH_TOO_DEEP';
export declare class GraphCreateError extends Error {
    readonly code: GraphErrorCode;
    /** JSON-pointer-ish path to the offending node, for actionable 422s. */
    readonly path: string;
    constructor(code: GraphErrorCode, path: string, message: string);
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
export declare function resolveGraph(body: unknown, options: GraphCreateOptions): GraphCreateResult;
export interface GraphRequestLike {
    method: string;
    body?: unknown;
}
export interface GraphResponseLike {
    locals: Record<string, unknown>;
    status(code: number): GraphResponseLike;
    json(payload: unknown): unknown;
}
export type GraphNext = (err?: unknown) => void;
/**
 * Express middleware wrapping `resolveGraph`.
 *
 * Mount it ahead of the create routes. Handlers downstream see a body whose
 * ids are already minted and whose references are already resolved, and the
 * `idMap` is merged into the JSON response automatically — so a route opts in
 * to graph create by doing nothing at all.
 */
export declare function graphCreate(options: GraphCreateOptions): (req: GraphRequestLike, res: GraphResponseLike, next: GraphNext) => void;
/** The minted ids for a request, for handlers that need them directly. */
export declare function idMapOf(res: GraphResponseLike): Record<string, string>;
/** Re-exported so consumers can type an id column without a second import. */
export type { EntityId };
