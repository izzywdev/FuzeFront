/**
 * Unit tests for the security middleware (the appsec fixes):
 *  - HIGH-2: requireInternalToken fails CLOSED in production when no token set.
 *  - HIGH-1: requireAdmin demands X-Billing-Actor-Is-Admin: true.
 *  - CRITICAL-2 / MEDIUM-1: requireActorContext parses + validates the trusted
 *    proxy headers (canonical X-Billing-* and the X-FF-* aliases).
 */
import {
  requireInternalToken,
  requireAdmin,
  requireActorContext,
  readActorContext,
} from '../../src/middleware/auth';

function mockRes() {
  const res: any = {};
  res.statusCode = 0;
  res.body = undefined;
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

function mockReq(headers: Record<string, string> = {}): any {
  // Express lowercases header keys.
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: lower };
}

describe('requireInternalToken (HIGH-2 fail-closed)', () => {
  const ORIG = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = ORIG;
  });

  it('allows when token matches', () => {
    const next = jest.fn();
    const res = mockRes();
    requireInternalToken('secret')(mockReq({ Authorization: 'Bearer secret' }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401 when token is wrong', () => {
    const next = jest.fn();
    const res = mockRes();
    requireInternalToken('secret')(mockReq({ Authorization: 'Bearer nope' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('FAILS CLOSED (503) in production when no token is configured', () => {
    process.env.NODE_ENV = 'production';
    const next = jest.fn();
    const res = mockRes();
    requireInternalToken(undefined)(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it('allows (dev bypass) when no token configured and NOT production', () => {
    process.env.NODE_ENV = 'test';
    const next = jest.fn();
    const res = mockRes();
    requireInternalToken(undefined)(mockReq(), res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireAdmin (HIGH-1)', () => {
  it('allows when X-Billing-Actor-Is-Admin is "true"', () => {
    const next = jest.fn();
    const res = mockRes();
    requireAdmin()(mockReq({ 'X-Billing-Actor-Is-Admin': 'true' }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('403 when the admin header is absent', () => {
    const next = jest.fn();
    const res = mockRes();
    requireAdmin()(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('403 when the admin header is not exactly "true"', () => {
    const next = jest.fn();
    const res = mockRes();
    requireAdmin()(mockReq({ 'X-Billing-Actor-Is-Admin': 'TRUE' }), res, next);
    expect(res.statusCode).toBe(403);
  });
});

describe('requireActorContext / readActorContext (CRITICAL-2 / MEDIUM-1)', () => {
  it('parses canonical X-Billing-* headers', () => {
    const ctx = readActorContext(
      mockReq({
        'X-Billing-Actor-User-Id': 'user-1',
        'X-Billing-Entity-Type': 'organization',
        'X-Billing-Entity-Id': 'org-1',
      }),
    );
    expect(ctx).toEqual({ actorUserId: 'user-1', entityType: 'organization', entityId: 'org-1' });
  });

  it('parses the X-FF-* aliases as organization scope', () => {
    const ctx = readActorContext(
      mockReq({ 'X-FF-Actor-Id': 'user-9', 'X-FF-Org-Id': 'org-9' }),
    );
    expect(ctx).toEqual({ actorUserId: 'user-9', entityType: 'organization', entityId: 'org-9' });
  });

  it('returns null when context is incomplete', () => {
    expect(readActorContext(mockReq({ 'X-Billing-Actor-User-Id': 'user-1' }))).toBeNull();
  });

  it('middleware 401s when no context present', () => {
    const next = jest.fn();
    const res = mockRes();
    requireActorContext()(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('middleware stashes req.actor and calls next when present', () => {
    const next = jest.fn();
    const res = mockRes();
    const req = mockReq({
      'X-Billing-Actor-User-Id': 'user-1',
      'X-Billing-Entity-Type': 'organization',
      'X-Billing-Entity-Id': 'org-1',
    });
    requireActorContext()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.actor).toEqual({ actorUserId: 'user-1', entityType: 'organization', entityId: 'org-1' });
  });
});
