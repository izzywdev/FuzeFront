// validateInput.ts — edge validation: nothing malformed reaches Postgres.
//
// Review H-4 (docs/security/selection-lists-authz-review-2026-10.md): a NUL byte
// in a `text` parameter makes Postgres raise SQLSTATE 22021, and ids/locales/
// keys flow straight into queries. Two edge checks, both answering
// 400 VALIDATION_ERROR (the contract's code for a malformed request):
//
//   1. `rejectNulBytes` — no NUL (U+0000) anywhere in the decoded path, the
//      query string, or the JSON body (keys included). Applied once at the app
//      level so no route has to remember it and no future field can forget it.
//   2. `registerIdParams(router)` — path ids are checked against the CONTRACT
//      shape before any handler runs: `listId` is a `front_sl_` id, `itemId` a
//      `front_sli_` id, `userId` a `usr_` id.
//
// WHY NOT identity's strict `parseId()` HERE. `parseId` additionally demands the
// 26-char Crockford-base32 TypeID suffix. The FROZEN contract (openapi.yaml
// `SelectionListId`/`SelectionListItemId`) is looser on purpose: pattern
// `^front_sl_[0-9a-z]+$`, maxLength 255, "validate the prefix; never parse past
// it and never assume a length". Strict parsing would turn contract-valid ids
// into 400s, so a never-minted id (which the contract answers 404) would change
// shape. The PREFIX comes from the identity registry (ENTITY_PREFIXES) so the
// two cannot drift; the suffix rule is the contract's. A well-formed id that
// does not exist still falls through to the org-scoped lookup and 404s.

import type { NextFunction, Request, Response, Router } from 'express';
import { ENTITY_PREFIXES } from '@izzywdev/fuzefront-identity';
import { getLog } from '../lib/logger';

const MAX_ID_LENGTH = 255;

/** The contract's suffix rule: one or more of [0-9a-z]. A literal regex, never built from input. */
const ID_SUFFIX = /^[0-9a-z]+$/;

/**
 * Build the contract's `^<prefix>_[0-9a-z]+$` (maxLength 255) matcher for a registered
 * prefix. The prefix is compared with startsWith and only the suffix goes through a
 * hardcoded regex, so no RegExp is ever constructed from a variable.
 */
function idMatcher(prefix: string): (raw: unknown) => boolean {
  const head = `${prefix}_`;
  return (raw) =>
    typeof raw === 'string' &&
    raw.length <= MAX_ID_LENGTH &&
    raw.startsWith(head) &&
    ID_SUFFIX.test(raw.slice(head.length));
}

export const isListId = idMatcher(ENTITY_PREFIXES.selectionList);
export const isItemId = idMatcher(ENTITY_PREFIXES.selectionListItem);
export const isUserId = idMatcher(ENTITY_PREFIXES.user);

function validationError(req: Request, res: Response, message: string, why: string): void {
  getLog(req).info({ why }, 'input rejected at the edge — 400');
  res.status(400).json({ code: 'VALIDATION_ERROR', message });
}

/** True if any string (or object key) reachable from `value` contains U+0000. */
export function containsNul(value: unknown, depth = 0): boolean {
  if (depth > 64) return true; // absurdly nested: refuse rather than recurse forever
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.includes('\u0000') || containsNul(v, depth + 1)) return true;
    }
  }
  return false;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // A malformed escape is itself malformed input.
    return '\u0000';
  }
}

/** 400 when a NUL byte appears in the path, query string or JSON body. */
export function rejectNulBytes(req: Request, res: Response, next: NextFunction): void {
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
  if (safeDecode(path).includes('\u0000') || containsNul(req.query) || containsNul(req.body)) {
    validationError(req, res, 'Request contains an invalid character.', 'nul-byte-or-bad-escape');
    return;
  }
  next();
}

/**
 * Validate `:listId` / `:itemId` / `:userId` path params for every route on
 * `router` that declares them. Runs before the route's own middleware, so a
 * malformed id never reaches the authz pre-check's DB lookup either.
 */
export function registerIdParams(router: Router): void {
  router.param('listId', (req, res, next, value) => {
    if (!isListId(value)) {
      validationError(req, res, `listId must be a '${ENTITY_PREFIXES.selectionList}_' id.`, 'bad-list-id');
      return;
    }
    next();
  });
  router.param('itemId', (req, res, next, value) => {
    if (!isItemId(value)) {
      validationError(req, res, `itemId must be a '${ENTITY_PREFIXES.selectionListItem}_' id.`, 'bad-item-id');
      return;
    }
    next();
  });
  router.param('userId', (req, res, next, value) => {
    if (!isUserId(value)) {
      validationError(req, res, `userId must be a '${ENTITY_PREFIXES.user}_'-prefixed user id.`, 'bad-user-id');
      return;
    }
    next();
  });
}
