import { Request, Response, NextFunction } from 'express';
import type { EntityType } from '../types';

/**
 * Trusted actor/entity context the host-backend billing proxy injects AFTER it
 * has authenticated the platform JWT and authorized the caller against the
 * target entity (object-level authz / BOLA defence lives in the proxy:
 * backend/src/routes/billing.ts). The billing-service treats these headers as
 * authoritative ONLY because the service is cluster-internal and reachable
 * solely through the proxy (the internal-token guard enforces that). The
 * service still RE-VERIFIES that the object being mutated (org / subscription)
 * actually belongs to this entity — see the CRITICAL-2 re-check in the
 * checkout/subscription routes.
 *
 * Header names — the canonical ones are what the merged proxy actually sends
 * (backend/src/routes/billing.ts `forward()`):
 *   X-Billing-Actor-User-Id : authenticated actor (req.user.id)
 *   X-Billing-Entity-Type   : server-derived authorized entity type
 *   X-Billing-Entity-Id     : server-derived authorized entity id
 *
 * We ALSO accept the shorter aliases X-FF-Actor-Id / X-FF-Org-Id (org-scope) so
 * the contract stays robust if the proxy header names are renamed concurrently
 * — whichever convention the proxy sends, the service re-verifies the binding.
 */
export const ACTOR_HEADER = 'x-billing-actor-user-id';
export const ENTITY_TYPE_HEADER = 'x-billing-entity-type';
export const ENTITY_ID_HEADER = 'x-billing-entity-id';
/** Alias headers (org-scope short form). */
export const ACTOR_HEADER_ALIAS = 'x-ff-actor-id';
export const ORG_HEADER_ALIAS = 'x-ff-org-id';
/** Set by the proxy ONLY for callers it has authorized as platform admins. */
export const ADMIN_HEADER = 'x-billing-actor-is-admin';

export interface ActorContext {
  actorUserId: string;
  entityType: EntityType;
  entityId: string;
}

/** Express request augmented with the verified actor context. */
export interface BillingRequest extends Request {
  actor?: ActorContext;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validates the internal Bearer token on non-webhook, non-public routes.
 * billing-service is not publicly exposed; callers (backend via
 * @fuzefront/billing-client) present BILLING_INTERNAL_TOKEN.
 *
 * HIGH-2 fix — FAIL CLOSED in production. Previously, when `expectedToken` was
 * unset the guard called next() unconditionally (fail-open), so a misconfigured
 * / token-less production deploy exposed every money-mutating route
 * unauthenticated. Now: if the token is unset we only allow the request OUTSIDE
 * production (and log a loud warning); in production an unset token is a
 * misconfiguration and we reject with 503 rather than silently allowing.
 */
export function requireInternalToken(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedToken) {
      if (isProduction()) {
        // Fail CLOSED: refuse to serve guarded routes without a configured token.
        console.error(
          '[auth] BILLING_INTERNAL_TOKEN is not set in production — refusing guarded request (fail-closed)',
        );
        res.status(503).json({ error: 'billing service misconfigured' });
        return;
      }
      // Dev convenience only (NODE_ENV !== 'production'): allow but warn loudly.
      console.warn(
        '[auth] BILLING_INTERNAL_TOKEN not set — internal-token guard disabled (dev only). ' +
          'This is NOT permitted in production.',
      );
      return next();
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (token && safeEqual(token, expectedToken)) {
      return next();
    }
    res.status(401).json({ error: 'unauthorized' });
  };
}

/**
 * Parses + validates the trusted actor/entity context headers the proxy injects
 * and stashes them on `req.actor`. Routes that mutate an entity's billing MUST
 * require this so they can re-verify the object↔entity binding.
 *
 * MEDIUM-1: the entity is SERVER-DERIVED upstream and carried here; routes must
 * use `req.actor.entityType/entityId` rather than trusting client body fields.
 *
 * CRITICAL-2: when the context is absent we DO NOT silently proceed (that would
 * let a client body field stand in for the authorized entity). We reject with
 * 401 — the proxy is the only legitimate caller and it always sets these.
 */
export function requireActorContext() {
  return (req: BillingRequest, res: Response, next: NextFunction): void => {
    const ctx = readActorContext(req);
    if (!ctx) {
      res.status(401).json({
        error: 'missing actor context',
        message:
          'X-Billing-Actor-User-Id + X-Billing-Entity-Type + X-Billing-Entity-Id ' +
          '(or X-FF-Actor-Id + X-FF-Org-Id) are required and set by the host proxy.',
      });
      return;
    }
    if (ctx.entityType !== 'user' && ctx.entityType !== 'organization') {
      res
        .status(400)
        .json({ error: 'invalid entity context', message: 'entity type must be user|organization' });
      return;
    }
    req.actor = ctx;
    return next();
  };
}

/**
 * Resolves the actor context from whichever header convention the proxy used.
 * Canonical (X-Billing-*) takes precedence; the X-FF-* aliases imply org-scope.
 */
export function readActorContext(req: Request): ActorContext | null {
  const actorUserId =
    readHeader(req, ACTOR_HEADER) ?? readHeader(req, ACTOR_HEADER_ALIAS);

  let entityType = readHeader(req, ENTITY_TYPE_HEADER) as EntityType | undefined;
  let entityId = readHeader(req, ENTITY_ID_HEADER);

  // Alias path: X-FF-Org-Id implies an organization-scoped entity.
  const orgAlias = readHeader(req, ORG_HEADER_ALIAS);
  if (!entityId && orgAlias) {
    entityId = orgAlias;
    entityType = 'organization';
  }

  if (!actorUserId || !entityType || !entityId) return null;
  return { actorUserId, entityType, entityId };
}

/**
 * HIGH-1: admin-only guard for the credits route. The proxy marks a caller it
 * has authorized as a platform admin with `X-Billing-Actor-Is-Admin: true`.
 * Absent / non-"true" → 403. This is in ADDITION to the internal-token guard
 * (the token only proves "the proxy is calling", not "this human is an admin").
 */
export function requireAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const flag = readHeader(req, ADMIN_HEADER);
    if (flag !== 'true') {
      res.status(403).json({
        error: 'forbidden',
        message: 'admin privileges required for this operation',
      });
      return;
    }
    return next();
  };
}

function readHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim() || undefined;
  return undefined;
}

/** Constant-time-ish comparison to avoid trivial timing leaks on the token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
