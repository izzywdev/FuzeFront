import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../../src/middleware/auth';

const JWT_SECRET = 'test-secret-ffrnt-157-auth';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): Response & { statusCode?: number; body?: unknown } {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('requireAuth', () => {
  const originalSecret = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });
  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('401s with no Authorization header', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res.body as any).code).toBe('UNAUTHENTICATED');
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on a malformed Authorization header (no Bearer prefix)', () => {
    const req = makeReq({ authorization: 'not-a-bearer-token' });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on an invalid/expired token', () => {
    const req = makeReq({ authorization: 'Bearer not-a-real-jwt' });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((res.body as any).code).toBe('UNAUTHENTICATED');
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on a token signed with a different secret', () => {
    const token = jwt.sign({ userId: 'usr_1' }, 'wrong-secret');
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches userId/orgId/portalId on a valid token', () => {
    const token = jwt.sign({ userId: 'usr_1', orgId: 'org_1', portalId: 'prt_1' }, JWT_SECRET);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('usr_1');
    expect(req.orgId).toBe('org_1');
    expect(req.portalId).toBe('prt_1');
  });

  it('accepts the organizationId claim alias for orgId', () => {
    const token = jwt.sign({ userId: 'usr_1', organizationId: 'org_2' }, JWT_SECRET);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.orgId).toBe('org_2');
  });

  it('503s (fail closed) when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;
    const token = jwt.sign({ userId: 'usr_1' }, JWT_SECRET);
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
