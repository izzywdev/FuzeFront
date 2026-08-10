/**
 * Mutation classification.
 *
 * This file is the safety core of the gateway. Everything else is plumbing.
 *
 * The rule the products care about: an operation that cannot be undone must be
 * declared `mutates: true`, and must never be reachable as a side effect of a
 * read or a "preview". FuzeService's approval decision is the canonical case —
 * `POST /approvals/{approvalId}/decision` is irreversible from the requester's
 * side, so it must be impossible to trigger by calling something that looks
 * like a query.
 *
 * We get that structurally rather than by convention: one MCP tool maps to
 * exactly ONE OpenAPI operation and issues exactly that one HTTP request. A
 * read tool has no code path that can reach a mutating operation, because it
 * has no code path that can reach a second request at all.
 */

/** HTTP methods that RFC 9110 defines as safe (no intended state change). */
const SAFE_METHODS = new Set(['get', 'head', 'options', 'trace']);

/**
 * Paths where a POST is a read in disguise — the request body is a query too
 * large or too structured for a query string. This is an allowlist of SUFFIXES,
 * not a substring match: `/tickets/search` qualifies, `/search-index/rebuild`
 * does not.
 */
const READ_ONLY_POST_SUFFIXES = ['/search', '/query', '/preview'];

export type Reversibility = 'reversible' | 'irreversible';

export interface Classification {
  mutates: boolean;
  /**
   * Only meaningful when `mutates` is true. `irreversible` means there is no
   * compensating operation the caller can invoke to undo it — the effect is
   * final from the caller's side even if an operator could repair it manually.
   */
  reversibility: Reversibility;
  /** Why this classification was chosen, surfaced in the tool description. */
  reason: string;
}

/** A per-product override entry, loaded from the product's overrides file. */
export interface OverrideEntry {
  mutates?: boolean;
  reversibility?: Reversibility;
  reason?: string;
}

export type Overrides = Record<string, OverrideEntry>;

export class ClassificationError extends Error {}

function isReadOnlyPostPath(path: string): boolean {
  const p = path.replace(/\/+$/, '').toLowerCase();
  return READ_ONLY_POST_SUFFIXES.some(s => p.endsWith(s));
}

/**
 * Derive the default classification from the HTTP method alone, before any
 * override is applied.
 */
export function deriveFromMethod(method: string, path: string): Classification {
  const m = method.toLowerCase();

  if (SAFE_METHODS.has(m)) {
    return {
      mutates: false,
      reversibility: 'reversible',
      reason: `${m.toUpperCase()} is a safe method`,
    };
  }

  if (m === 'post' && isReadOnlyPostPath(path)) {
    return {
      mutates: false,
      reversibility: 'reversible',
      reason: `POST ${path} is a query-shaped read (body-as-query)`,
    };
  }

  // DELETE is assumed irreversible by default: a deleted resource is not
  // recoverable through the API that deleted it. A product that has real
  // undelete can downgrade it explicitly in its overrides file.
  if (m === 'delete') {
    return {
      mutates: true,
      reversibility: 'irreversible',
      reason: 'DELETE removes a resource with no API-level undo',
    };
  }

  return {
    mutates: true,
    reversibility: 'reversible',
    reason: `${m.toUpperCase()} writes state`,
  };
}

/**
 * Apply a product's override on top of the derived classification, enforcing
 * the invariants that make the whole thing trustworthy.
 *
 * Throws — and the gateway refuses to start — rather than silently accepting a
 * dangerous declaration. A gateway that boots with a mis-declared irreversible
 * tool is worse than one that does not boot, because the caller has no way to
 * tell the difference until something unrecoverable has already happened.
 */
export function classify(
  method: string,
  path: string,
  toolName: string,
  override?: OverrideEntry
): Classification {
  const derived = deriveFromMethod(method, path);
  if (!override) return derived;

  const result: Classification = {
    mutates: override.mutates ?? derived.mutates,
    reversibility: override.reversibility ?? derived.reversibility,
    reason: override.reason ?? derived.reason,
  };

  // INVARIANT 1: irreversible implies mutating. An override that claims an
  // irreversible operation is a read is the single most dangerous thing this
  // file can be asked to accept, so it is a hard failure.
  if (result.reversibility === 'irreversible' && !result.mutates) {
    throw new ClassificationError(
      `Tool "${toolName}" (${method.toUpperCase()} ${path}) is declared irreversible but mutates:false. ` +
        `An irreversible operation must be mutates:true — it cannot be exposed as a read.`
    );
  }

  // INVARIANT 2: an unsafe HTTP method may only be downgraded to a read on a
  // query-shaped path. Otherwise any write could be relabelled a read and
  // become reachable from a context that believes it is only looking.
  if (!result.mutates && !SAFE_METHODS.has(method.toLowerCase())) {
    if (!(method.toLowerCase() === 'post' && isReadOnlyPostPath(path))) {
      throw new ClassificationError(
        `Tool "${toolName}" (${method.toUpperCase()} ${path}) is overridden to mutates:false, but ` +
          `${method.toUpperCase()} is not a safe method and the path is not query-shaped ` +
          `(${READ_ONLY_POST_SUFFIXES.join(', ')}). Only a POST to a query-shaped path may be declared a read.`
      );
    }
  }

  // INVARIANT 3: a safe method cannot be declared irreversible. If a GET really
  // changes state, the spec is wrong and that is what needs fixing.
  if (SAFE_METHODS.has(method.toLowerCase()) && result.reversibility === 'irreversible') {
    throw new ClassificationError(
      `Tool "${toolName}" (${method.toUpperCase()} ${path}) is a safe method declared irreversible. ` +
        `Fix the OpenAPI spec rather than the override — a GET must not change state.`
    );
  }

  return result;
}
