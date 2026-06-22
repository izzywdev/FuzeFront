// mutating.test.ts — the confirmation gate. permit deny → tool_denied (nothing
// registered); permit allow → tool_pending with a confirmationId registered in
// the store. Permit + ConfirmationStore behavior verified with the real store.

import { prepareMutatingTool } from '../../src/agent/mutating';
import { ConfirmationStore } from '../../src/agent/confirmation';

const TOOL = {
  name: 'create_org',
  description: 'Create an organization.',
  permit: { resource: 'organization', action: 'create' },
};

const CTX = { userId: 'u1', orgId: 'org-1' };
const ARGS = { name: 'Acme', slug: 'acme' };

describe('prepareMutatingTool', () => {
  it('emits tool_denied and registers nothing when Permit denies', async () => {
    const confirmations = new ConfirmationStore();
    const registerSpy = jest.spyOn(confirmations, 'register');
    const permit = { check: jest.fn().mockResolvedValue(false) };

    const { event } = await prepareMutatingTool(TOOL, ARGS, CTX, { permit, confirmations });

    expect(permit.check).toHaveBeenCalledWith({
      user: 'u1',
      action: 'create',
      resource: 'organization',
      tenant: 'org-1',
    });
    expect(event.type).toBe('tool_denied');
    if (event.type === 'tool_denied') {
      expect(event.toolName).toBe('create_org');
      expect(event.reason).toMatch(/organization:create/);
    }
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('emits tool_pending and registers a confirmable pending entry when allowed', async () => {
    const confirmations = new ConfirmationStore();
    const permit = { check: jest.fn().mockResolvedValue(true) };

    const { event } = await prepareMutatingTool(TOOL, ARGS, CTX, { permit, confirmations });

    expect(event.type).toBe('tool_pending');
    if (event.type !== 'tool_pending') throw new Error('expected tool_pending');
    expect(event.toolName).toBe('create_org');
    expect(event.args).toEqual(ARGS);
    expect(event.description).toBe('Create an organization.');
    expect(event.confirmationId).toBeTruthy();

    // The id is a real, owner-scoped pending entry the confirm route can release.
    const pending = confirmations.confirm(event.confirmationId, 'u1');
    expect(pending).toMatchObject({ toolName: 'create_org', args: ARGS });
  });
});
