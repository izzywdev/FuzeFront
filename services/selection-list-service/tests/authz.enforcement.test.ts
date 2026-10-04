// authz.enforcement.test.ts — review H-1: authorization is ALWAYS enforced in
// production; FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED is a dev/test convenience.
//
// Both states, both layers:
//   - isAuthzEnforced(): the single implementation of the invariant
//   - requireAuthzCheck() / filterReadable(): the call sites that use it
//
//   production      → enforced whatever the env var says (unset / 'false' / 'true')
//   non-production  → env var honoured; default OFF (pass-through + warning)

jest.mock('../src/db', () => {
  const mockDb: any = jest.fn(() => mockDb);
  mockDb.where = jest.fn(() => mockDb);
  mockDb.first = jest.fn(() => Promise.resolve({ id: 'front_sl_exists' }));
  return { db: mockDb };
});

import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { AuthzClient } from '@fuzefront/auth';
import {
  requireAuthzCheck,
  filterReadable,
  isAuthzEnabled,
  _setAuthzClientForTesting,
  makeNoOpProxy,
} from '../src/middleware/authz';
import { isAuthzEnforced } from '../src/middleware/authz.flags';
import { authMiddleware } from '../src/middleware/auth';

const ENV_VAR = 'FUZEFRONT_SELECTION_LIST_AUTHZ_ENABLED';
const JWT_SECRET = process.env.TEST_JWT_SECRET ?? 'test-only-not-a-real-secret-authz-enforcement';
process.env.JWT_SECRET = JWT_SECRET;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(v: string | undefined): void {
  if (v === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = v;
}

const token = () => jwt.sign({ userId: 'usr_tester01', orgId: 'org_acme' }, JWT_SECRET);

function makeApp(): express.Application {
  const app = express();
  app.use(authMiddleware);
  app.get(
    '/lists/:listId',
    requireAuthzCheck('SelectionList', 'delete'),
    (_req: Request, res: Response) => res.status(200).json({ reached: true }),
  );
  return app;
}

function denyAllClient(): { client: AuthzClient; check: jest.Mock } {
  const check = jest.fn().mockResolvedValue({ allow: false });
  const client = {
    check,
    bulkCheck: jest.fn().mockResolvedValue([{ allow: false }]),
    grant: jest.fn(),
    revoke: jest.fn(),
    listGrants: jest.fn(),
  } as unknown as AuthzClient;
  return { client, check };
}

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
  delete process.env[ENV_VAR];
  _setAuthzClientForTesting(makeNoOpProxy());
});

describe('isAuthzEnforced', () => {
  const ctx = { userId: 'usr_a', orgId: 'org_a' };

  describe('NODE_ENV=production — always enforced', () => {
    beforeEach(() => setNodeEnv('production'));

    it.each([
      ['unset', undefined],
      ["'false'", 'false'],
      ["'true'", 'true'],
      ['garbage', 'maybe'],
    ])('is true when the env var is %s', async (_label, value) => {
      if (value === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = value;
      await expect(isAuthzEnforced(ctx)).resolves.toBe(true);
    });
  });

  describe('non-production — the env var is honoured (dev/test convenience)', () => {
    it.each(['test', 'development', undefined as unknown as string])(
      'NODE_ENV=%s: default (unset) is OFF',
      async (env) => {
        setNodeEnv(env);
        delete process.env[ENV_VAR];
        await expect(isAuthzEnforced(ctx)).resolves.toBe(false);
      },
    );

    it("'true' turns it ON", async () => {
      setNodeEnv('test');
      process.env[ENV_VAR] = 'true';
      await expect(isAuthzEnforced(ctx)).resolves.toBe(true);
    });

    it("'false' keeps it OFF", async () => {
      setNodeEnv('development');
      process.env[ENV_VAR] = 'false';
      await expect(isAuthzEnforced(ctx)).resolves.toBe(false);
    });
  });
});

describe('requireAuthzCheck — production enforces regardless of the env var', () => {
  it.each([
    ['unset', undefined],
    ["'false' (the kill-switch value)", 'false'],
  ])('NODE_ENV=production + env var %s: a denial is a 403 and the handler is NOT reached', async (_l, value) => {
    setNodeEnv('production');
    if (value === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = value;
    const { client, check } = denyAllClient();
    _setAuthzClientForTesting(client);

    const res = await request(makeApp())
      .get('/lists/front_sl_exists')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(check).toHaveBeenCalledTimes(1); // a real Security API decision was asked for
  });

  it('NODE_ENV=production fails CLOSED when the Security API throws (even with the env var unset)', async () => {
    setNodeEnv('production');
    delete process.env[ENV_VAR];
    _setAuthzClientForTesting({
      check: jest.fn().mockRejectedValue(new Error('security api down')),
      bulkCheck: jest.fn(),
      grant: jest.fn(),
      revoke: jest.fn(),
      listGrants: jest.fn(),
    } as unknown as AuthzClient);

    const res = await request(makeApp())
      .get('/lists/front_sl_exists')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
  });

  it('isAuthzEnabled() and filterReadable() enforce in production with the env var unset', async () => {
    setNodeEnv('production');
    delete process.env[ENV_VAR];
    const { client } = denyAllClient();
    _setAuthzClientForTesting(client);
    const req = {
      userId: 'usr_tester01',
      orgId: 'org_acme',
      headers: { authorization: `Bearer ${token()}` },
    } as unknown as Request;

    await expect(isAuthzEnabled(req)).resolves.toBe(true);
    // Deny-all bulkCheck: the row must be filtered OUT, not passed through.
    await expect(filterReadable(req, [{ id: 'front_sl_a' }])).resolves.toEqual([]);
  });
});

describe('requireAuthzCheck — non-production honours the env var', () => {
  it('OFF (default): pass-through, NO Security API call', async () => {
    setNodeEnv('test');
    delete process.env[ENV_VAR];
    const { client, check } = denyAllClient();
    _setAuthzClientForTesting(client);

    const res = await request(makeApp())
      .get('/lists/front_sl_exists')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
    expect(check).not.toHaveBeenCalled();
  });

  it('ON: a real decision is asked for and a denial is a 403', async () => {
    setNodeEnv('test');
    process.env[ENV_VAR] = 'true';
    const { client, check } = denyAllClient();
    _setAuthzClientForTesting(client);

    const res = await request(makeApp())
      .get('/lists/front_sl_exists')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
