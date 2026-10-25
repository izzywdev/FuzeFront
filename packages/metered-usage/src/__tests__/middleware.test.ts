import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { meteringMiddleware } from '../middleware/express';
import { emitTokenUsage, emitStorageUsage } from '../middleware/tokens';
import type { MeteringClient } from '../client';
import type { UsageEvent } from '../types';

// ---------------------------------------------------------------------------
// Helpers — minimal Express request/response mocks
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/v1/resource',
    method: 'GET',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _finishListeners: Array<() => void> } {
  const listeners: Array<() => void> = [];
  return {
    on(event: string, cb: () => void) {
      if (event === 'finish') listeners.push(cb);
    },
    _finishListeners: listeners,
  } as unknown as Response & { _finishListeners: Array<() => void> };
}

function fireFinish(res: ReturnType<typeof makeRes>): void {
  res._finishListeners.forEach((fn) => fn());
}

function makeMockClient(): MeteringClient {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as MeteringClient;
}

// ---------------------------------------------------------------------------
// meteringMiddleware tests
// ---------------------------------------------------------------------------

describe('meteringMiddleware', () => {
  let client: MeteringClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('calls next() immediately — does not block the request', () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
    });

    handler(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    // emit has NOT been called yet (event fires on finish)
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('emits api_calls=1 after the response finishes (defaults)', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);

    // emit is async/fire-and-forget; we wait a tick to let the microtask run
    await Promise.resolve();

    expect(client.emit).toHaveBeenCalledTimes(1);
    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.meterEventName).toBe('api_calls');
    expect(event.quantity).toBe(1);
    expect(event.entityType).toBe('organization');
    expect(event.entityId).toBe('org_01abc');
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does NOT emit when skip() returns true', async () => {
    const next = vi.fn();
    const req = makeReq({ path: '/health' });
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
      skip: (r) => r.path === '/health',
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    expect(client.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when entityIdFromRequest returns empty string', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => '',
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    expect(client.emit).not.toHaveBeenCalled();
  });

  it('uses a static quantity value when provided', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
      quantity: 5,
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.quantity).toBe(5);
  });

  it('uses a quantity FUNCTION — called with req and res after finish', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const quantityFn = vi.fn().mockReturnValue(42);
    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
      quantity: quantityFn,
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    expect(quantityFn).toHaveBeenCalledWith(req, res);
    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.quantity).toBe(42);
  });

  it('falls back to quantity=1 if the quantity function throws', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'org_01abc',
      quantity: () => { throw new Error('bad fn'); },
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.quantity).toBe(1);
  });

  it('uses custom meter name when provided', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      meter: 'tokens_consumed',
      entityIdFromRequest: () => 'org_01abc',
      quantity: 100,
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.meterEventName).toBe('tokens_consumed');
  });

  it('uses entityType "user" when configured', async () => {
    const next = vi.fn();
    const req = makeReq();
    const res = makeRes();

    const handler = meteringMiddleware(client, {
      entityIdFromRequest: () => 'usr_01abc',
      entityType: 'user',
    });

    handler(req, res as unknown as Response, next);
    fireFinish(res);
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.entityType).toBe('user');
    expect(event.entityId).toBe('usr_01abc');
  });
});

// ---------------------------------------------------------------------------
// emitTokenUsage helper tests
// ---------------------------------------------------------------------------

describe('emitTokenUsage()', () => {
  let client: MeteringClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('emits tokens_consumed with the given token count', async () => {
    emitTokenUsage(client, 'org_01abc', 512);
    await Promise.resolve();

    expect(client.emit).toHaveBeenCalledTimes(1);
    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.meterEventName).toBe('tokens_consumed');
    expect(event.quantity).toBe(512);
    expect(event.entityType).toBe('organization');
    expect(event.entityId).toBe('org_01abc');
  });

  it('accepts custom entityType', async () => {
    emitTokenUsage(client, 'usr_01xyz', 100, 'user');
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.entityType).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// emitStorageUsage helper tests
// ---------------------------------------------------------------------------

describe('emitStorageUsage()', () => {
  let client: MeteringClient;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('emits storage_bytes with the given byte count', async () => {
    emitStorageUsage(client, 'org_01abc', 1024 * 1024);
    await Promise.resolve();

    expect(client.emit).toHaveBeenCalledTimes(1);
    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.meterEventName).toBe('storage_bytes');
    expect(event.quantity).toBe(1024 * 1024);
    expect(event.entityType).toBe('organization');
  });

  it('accepts custom entityType', async () => {
    emitStorageUsage(client, 'usr_01xyz', 512, 'user');
    await Promise.resolve();

    const event = (client.emit as ReturnType<typeof vi.fn>).mock.calls[0][0] as UsageEvent;
    expect(event.entityType).toBe('user');
  });
});
