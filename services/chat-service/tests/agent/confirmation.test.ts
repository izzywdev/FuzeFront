// confirmation.test.ts — pending-tool confirmation state machine (plan §6c / T4.5).
// Pending confirmations expire after a timeout; confirm/cancel resolve them.

import { ConfirmationStore } from '../../src/agent/confirmation';

describe('ConfirmationStore', () => {
  it('registers a pending confirmation and returns a unique id', () => {
    const store = new ConfirmationStore();
    const a = store.register({ userId: 'u1', toolName: 'create_org', args: { name: 'X' } });
    const b = store.register({ userId: 'u1', toolName: 'create_org', args: { name: 'Y' } });
    expect(a.confirmationId).toBeTruthy();
    expect(b.confirmationId).not.toBe(a.confirmationId);
  });

  it('confirm() returns the pending payload and marks it confirmed (owner only)', () => {
    const store = new ConfirmationStore();
    const { confirmationId } = store.register({
      userId: 'u1',
      toolName: 'create_org',
      args: { name: 'X' },
    });
    const result = store.confirm(confirmationId, 'u1');
    expect(result).toMatchObject({ toolName: 'create_org', args: { name: 'X' } });
    // second confirm of the same id fails (already consumed)
    expect(store.confirm(confirmationId, 'u1')).toBeNull();
  });

  it('confirm() denies a different user (cannot confirm someone elses tool)', () => {
    const store = new ConfirmationStore();
    const { confirmationId } = store.register({
      userId: 'u1',
      toolName: 'create_org',
      args: {},
    });
    expect(store.confirm(confirmationId, 'attacker')).toBeNull();
    // still pending for the real owner
    expect(store.confirm(confirmationId, 'u1')).not.toBeNull();
  });

  it('cancel() clears a pending confirmation', () => {
    const store = new ConfirmationStore();
    const { confirmationId } = store.register({ userId: 'u1', toolName: 't', args: {} });
    expect(store.cancel(confirmationId, 'u1')).toBe(true);
    expect(store.confirm(confirmationId, 'u1')).toBeNull();
  });

  it('expires pending confirmations after the TTL', () => {
    jest.useFakeTimers();
    try {
      const store = new ConfirmationStore({ ttlMs: 1000 });
      const { confirmationId } = store.register({ userId: 'u1', toolName: 't', args: {} });
      jest.advanceTimersByTime(1001);
      expect(store.confirm(confirmationId, 'u1')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('confirm() returns null for an unknown id', () => {
    const store = new ConfirmationStore();
    expect(store.confirm('does-not-exist', 'u1')).toBeNull();
  });
});
