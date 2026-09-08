// auth.ts — devportal-service's own OIDC login/callback/logout.
//
// docs/planning/developers-portal.md §5.1/§5.2. Flow:
//   1. GET /auth/oidc/login    -> redirect to Authentik authorize URL
//      (state + PKCE verifier stashed in short-lived httpOnly cookies —
//      this service may run multiple replicas, so server-memory storage
//      would break as soon as the callback lands on a different pod).
//   2. GET /auth/oidc/callback -> exchange code, get userinfo, resolve to a
//      FuzeFront user via security-service's /internal/oidc-sync, provision
//      root-org `developer` via /internal/devportal-provision, mint our own
//      session cookie, redirect to the frontend.
//   3. POST /auth/logout       -> clear the session cookie.

import { Router, Request, Response } from 'express';
import { buildAuthorizeUrl, completeCallback } from '../services/oidcClient';
import { syncOidcUser, provisionDeveloper } from '../services/internalClient';
import { signSession, SESSION_COOKIE } from '../middleware/auth';

const router = Router();

const STATE_COOKIE = 'devportal_oidc_state';
const VERIFIER_COOKIE = 'devportal_oidc_verifier';
const TEMP_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — just long enough for the Authentik round trip.

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

router.get('/oidc/login', async (_req: Request, res: Response) => {
  try {
    const { url, state, codeVerifier } = await buildAuthorizeUrl();

    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      maxAge: TEMP_COOKIE_MAX_AGE_MS,
    });
    res.cookie(VERIFIER_COOKIE, codeVerifier, {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      maxAge: TEMP_COOKIE_MAX_AGE_MS,
    });

    res.redirect(url);
  } catch (error: any) {
    console.error('[devportal-auth] Failed to build authorize URL:', error);
    res.status(503).json({ error: 'OIDC not configured', detail: String(error?.message ?? error) });
  }
});

router.get('/oidc/callback', async (req: Request, res: Response) => {
  const expectedState = (req as any).cookies?.[STATE_COOKIE];
  const codeVerifier = (req as any).cookies?.[VERIFIER_COOKIE];
  res.clearCookie(STATE_COOKIE);
  res.clearCookie(VERIFIER_COOKIE);

  if (!expectedState || !codeVerifier) {
    res.status(400).json({ error: 'Missing OIDC state — please sign in again.' });
    return;
  }

  try {
    const userinfo = await completeCallback(req, expectedState, codeVerifier);
    const { userId, email } = await syncOidcUser(userinfo);
    await provisionDeveloper(userId);

    const token = signSession({ userId, email });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProd(),
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    const frontendUrl = process.env.DEVPORTAL_FRONTEND_URL || '/';
    res.redirect(frontendUrl);
  } catch (error: any) {
    console.error('[devportal-auth] OIDC callback failed:', error);
    res.status(401).json({ error: 'Sign-in failed', detail: String(error?.message ?? error) });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

export default router;
