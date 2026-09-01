/**
 * @fuzefront/service-auth — Express middleware tests.
 *
 * Asserts the gate's contract: it never calls next() on an unauthenticated or
 * unauthorized request, missing/garbage headers are rejected outright, and a
 * failing/throwing `authorize` hook denies rather than passes through.
 */
import type { Request, Response } from 'express';
import { requireMachineAuth } from '../src/middleware';
import { ServiceAuthError, MachineIdentity } from '../src/types';
import type { MachineTokenVerifier } from '../src/verifier';

function mkReq(headers: Record<string, string> = {}): Request {
  return { headers } as any;
}
function mkRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
/** Run a middleware and resolve once next() or res.json() has fired. */
function run(mw: any, req: any, res: any): Promise<{ nexted: boolean }> {
  return new Promise(resolve => {
    let done = false;
    const finish = (nexted: boolean) => {
      if (!done) {
        done = true;
        resolve({ nexted });
      }
    };
    const originalJson = res.json;
    res.json = jest.fn((...args: unknown[]) => {
      finish(false);
      return originalJson(...args);
    });
    mw(req, res, () => finish(true));
  });
}

const identity: MachineIdentity = {
  subject: 'svc-billing',
  tenantId: 'org_1',
  scopes: ['invoices:read'],
  raw: { active: true },
};

function fakeVerifier(fn: (token: string) => Promise<MachineIdentity>): MachineTokenVerifier {
  return { verifyMachineToken: jest.fn(fn) };
}

describe('requireMachineAuth', () => {
  it('rejects a request with NO Authorization header (401 NO_TOKEN), never calls next()', async () => {
    const verifier = fakeVerifier(async () => identity);
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier }), mkReq(), res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_TOKEN' }));
  });

  it('rejects a garbage Authorization header (wrong scheme), never calls next()', async () => {
    const verifier = fakeVerifier(async () => identity);
    const res = mkRes();
    const req = mkReq({ authorization: 'Basic garbage-not-a-bearer-token' });
    const { nexted } = await run(requireMachineAuth({ verifier }), req, res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(verifier.verifyMachineToken).not.toHaveBeenCalled();
  });

  it('rejects "Bearer" with no token value, never calls next()', async () => {
    const verifier = fakeVerifier(async () => identity);
    const res = mkRes();
    const req = mkReq({ authorization: 'Bearer ' });
    const { nexted } = await run(requireMachineAuth({ verifier }), req, res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('attaches the MachineIdentity and calls next() for a valid token with no authorize hook', async () => {
    const verifier = fakeVerifier(async token => {
      expect(token).toBe('good-token');
      return identity;
    });
    const req = mkReq({ authorization: 'Bearer good-token' });
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier }), req, res);

    expect(nexted).toBe(true);
    expect((req as any).machineIdentity).toBe(identity);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when verification fails (inactive/expired/network) — never calls next()', async () => {
    const verifier = fakeVerifier(async () => {
      throw new ServiceAuthError('TOKEN_INACTIVE', 'inactive', 401);
    });
    const req = mkReq({ authorization: 'Bearer bad-token' });
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier }), req, res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INACTIVE' }));
  });

  it('calls next() when the authorize hook allows', async () => {
    const verifier = fakeVerifier(async () => identity);
    const authorize = jest.fn(async () => true);
    const req = mkReq({ authorization: 'Bearer good-token' });
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier, authorize }), req, res);

    expect(nexted).toBe(true);
    expect(authorize).toHaveBeenCalledWith(identity, req);
  });

  it('denies with 403 when the authorize hook returns false — never calls next()', async () => {
    const verifier = fakeVerifier(async () => identity);
    const authorize = jest.fn(async () => false);
    const req = mkReq({ authorization: 'Bearer good-token' });
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier, authorize }), req, res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('fails closed (403) when the authorize hook THROWS — never calls next()', async () => {
    const verifier = fakeVerifier(async () => identity);
    const authorize = jest.fn(async () => {
      throw new Error('policy engine unreachable');
    });
    const req = mkReq({ authorization: 'Bearer good-token' });
    const res = mkRes();
    const { nexted } = await run(requireMachineAuth({ verifier, authorize }), req, res);

    expect(nexted).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('throws at wiring time (MISCONFIGURED) when built without a verifier', () => {
    expect(() => requireMachineAuth({} as any)).toThrow(ServiceAuthError);
  });
});
