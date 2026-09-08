// authz.ts — authorization for devportal-service, routed through FuzeFront's
// Security API (backend/security's `/api/v1/security/authz/*`), exactly like
// services/selection-list-service/src/middleware/authz.ts. NO embedded
// Permit.io SDK, no vendor API key here — see that file's header comment for
// the full design rationale (fail-closed, NODE_ENV=test no-op, dark-deploy
// flag gate), reproduced only where it differs below.
//
// The one structural difference from selection-list-service: DevPortalCatalog
// / DevPortalPlayground (backend/src/permit/schema.ts) are ROOT-TENANT scoped
// resources, not per-organization. Every check here is therefore always
// against ROOT_ORG_ID, never `req.orgId` — a devportal sign-in has no
// concept of "which org" the way a SelectionList check does.

import { Request, Response, NextFunction } from 'express';
import { AuthzClient, createAuthzClient } from '@fuzefront/auth';
import { getBooleanFlag, FLAGS, FlagContext } from './authz.flags';

const SECURITY_SERVICE_URL = process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002';

// docs/planning/developers-portal.md §5.2 — the same platform root org every
// devportal `developer` membership is provisioned against
// (backend/src/migrations/015_seed_root_platform_organization.ts).
export const ROOT_ORG_ID = '00000000-0000-0000-0000-000000000010';

export const isNoOpMode: boolean = process.env.NODE_ENV === 'test';

function makeNoOpProxy(): AuthzClient {
  return {
    check: async () => ({ allow: true }),
    bulkCheck: async checks => checks.map(() => ({ allow: true })),
    grant: async req => ({
      id: `${req.tenant}:${req.subject}:${req.role}`,
      subject: req.subject,
      tenant: req.tenant,
      role: req.role,
      permission: req.permission,
      resource: req.resource,
    }),
    revoke: async () => undefined,
    listGrants: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
  };
}

let _authzClient: AuthzClient = isNoOpMode
  ? makeNoOpProxy()
  : createAuthzClient({ baseUrl: SECURITY_SERVICE_URL });

export function getAuthzClient(): AuthzClient {
  return _authzClient;
}

export function _setAuthzClientForTesting(client: AuthzClient): void {
  _authzClient = client;
}

export { makeNoOpProxy };

export function bearer(req: Request): string | null {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Returns an Express middleware that enforces a DevPortalCatalog /
 * DevPortalPlayground decision via the Security API, always at ROOT_ORG_ID.
 *
 * Flag OFF -> pass-through with a warning log (dark deploy / kill-switch).
 * Flag ON  -> real check, fail closed on any error.
 */
export function requireAuthzCheck(resource: string, action: string) {
  return async function authzMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing devportal session.' });
      return;
    }

    const flagCtx: FlagContext = { userId, orgId: ROOT_ORG_ID };
    const authzEnabled = await getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, flagCtx);

    if (!authzEnabled) {
      console.warn(
        '[authz] authz-enabled flag is OFF — passing through without a Security API check.',
        { userId, resource, action }
      );
      next();
      return;
    }

    try {
      const decision = await getAuthzClient().check(
        {
          subject: userId,
          tenant: ROOT_ORG_ID,
          resource: { type: resource },
          action,
        },
        // The Security API's check() takes the caller's own bearer token when
        // one is available (selection-list-service's convention); devportal
        // sessions are httpOnly-cookie-based, so this is best-effort and the
        // client falls back to its own service credential when absent.
        bearer(req) || ''
      );
      if (!decision.allow) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Permission denied.' });
        return;
      }
      next();
    } catch (err) {
      console.error('[authz] Security API check threw — failing closed.', { err, userId, resource, action });
      res.status(403).json({ code: 'FORBIDDEN', message: 'Authorization service unavailable.' });
    }
  };
}
