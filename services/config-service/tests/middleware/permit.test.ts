import { Request, Response } from 'express';
import { _setPermitClientForTesting, makeNoOpProxy, requirePermit } from '../../src/middleware/permit';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { params: {}, ...overrides } as unknown as Request;
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

describe('requirePermit', () => {
  afterEach(() => {
    // Restore the default no-op (allow-all, test-mode) client between tests.
    _setPermitClientForTesting(makeNoOpProxy());
  });

  it('401s when req.userId is missing (requireAuth must run first)', async () => {
    const middleware = requirePermit('ConfigScope', 'read');
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when Permit allows', async () => {
    _setPermitClientForTesting({ check: jest.fn().mockResolvedValue(true) });
    const middleware = requirePermit('ConfigScope', 'read');
    const req = makeReq({ userId: 'usr_1' } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403s (does not call next) when Permit denies', async () => {
    const check = jest.fn().mockResolvedValue(false);
    _setPermitClientForTesting({ check });
    const middleware = requirePermit('ConfigScope', 'read');
    const req = makeReq({ userId: 'usr_1', orgId: 'org_1' } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect((res.body as any).code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith('usr_1', 'read', { type: 'ConfigScope', tenant: 'org_1' });
  });

  it('fails CLOSED (403) when Permit.check() throws', async () => {
    _setPermitClientForTesting({ check: jest.fn().mockRejectedValue(new Error('PDP unreachable')) });
    const middleware = requirePermit('ConfigScope', 'read');
    const req = makeReq({ userId: 'usr_1' } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('derives the resource-instance key via resourceKeyOf when supplied', async () => {
    const check = jest.fn().mockResolvedValue(true);
    _setPermitClientForTesting({ check });
    const middleware = requirePermit('ConfigCatalog', 'read', (req) => (req.params as any).namespace);
    const req = makeReq({ userId: 'usr_1', params: { namespace: 'fuzefront.chat' } } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(check).toHaveBeenCalledWith('usr_1', 'read', {
      type: 'ConfigCatalog',
      tenant: 'platform',
      key: 'fuzefront.chat',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to the "platform" tenant when the request has no orgId', async () => {
    const check = jest.fn().mockResolvedValue(true);
    _setPermitClientForTesting({ check });
    const middleware = requirePermit('ConfigScope', 'read');
    const req = makeReq({ userId: 'usr_1' } as any);
    const res = makeRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(check).toHaveBeenCalledWith('usr_1', 'read', { type: 'ConfigScope', tenant: 'platform' });
  });
});
