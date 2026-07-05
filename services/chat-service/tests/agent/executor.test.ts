// executor.test.ts — mutating-tool execution behind the confirmation gate.
// Verifies: unknown/non-mutating rejection, fail-closed Permit deny, successful
// execution + allowed audit, execution-error audit, and that audit failures
// never throw out of the request path.

import { ToolExecutor, type PendingExecution } from '../../src/agent/executor';
import type { AgentTool } from '../../src/agent/tools/types';

function pending(overrides: Partial<PendingExecution> = {}): PendingExecution {
  return {
    userId: 'u1',
    orgId: 'org-1',
    conversationId: 'conv-1',
    toolName: 'create_org',
    args: { name: 'Acme' },
    token: 'tok',
    ...overrides,
  };
}

function makeTool(over: Partial<AgentTool<any, any>> = {}): AgentTool<any, any> {
  return {
    name: 'create_org',
    description: 'd',
    mutating: true,
    permit: { resource: 'organization', action: 'create' },
    execute: jest.fn().mockResolvedValue({ id: 'org-9' }),
    ...over,
  };
}

describe('ToolExecutor', () => {
  it('rejects an unknown tool and audits it as denied', async () => {
    const audit = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const permit = { check: jest.fn() };
    const exec = new ToolExecutor({ getTool: () => undefined, permit, audit });

    const result = await exec.execute(pending({ toolName: 'nope' }));

    expect(result.success).toBe(false);
    expect(permit.check).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ permitDecision: 'denied', toolName: 'nope' }),
    );
  });

  it('rejects a non-mutating tool through the confirm path', async () => {
    const audit = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const permit = { check: jest.fn() };
    const tool = makeTool({ mutating: false });
    const exec = new ToolExecutor({ getTool: () => tool, permit, audit });

    const result = await exec.execute(pending());
    expect(result.success).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('fails closed when Permit denies — no execution, denied audit', async () => {
    const tool = makeTool();
    const audit = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const permit = { check: jest.fn().mockResolvedValue(false) };
    const exec = new ToolExecutor({ getTool: () => tool, permit, audit });

    const result = await exec.execute(pending());

    expect(result.success).toBe(false);
    expect(tool.execute).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ permitDecision: 'denied', confirmed: true }),
    );
  });

  it('executes when allowed and audits success with the result', async () => {
    const tool = makeTool();
    const audit = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const permit = { check: jest.fn().mockResolvedValue(true) };
    const exec = new ToolExecutor({ getTool: () => tool, permit, audit });

    const result = await exec.execute(pending());

    expect(permit.check).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'u1', action: 'create', resource: 'organization', tenant: 'org-1' }),
    );
    expect(tool.execute).toHaveBeenCalledWith(
      { name: 'Acme' },
      { userId: 'u1', orgId: 'org-1', token: 'tok' },
    );
    expect(result).toMatchObject({ success: true, result: { id: 'org-9' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ permitDecision: 'allowed', result: { id: 'org-9' }, confirmed: true }),
    );
  });

  it('audits an execution error as allowed-but-failed and returns the message', async () => {
    const tool = makeTool({ execute: jest.fn().mockRejectedValue(new Error('backend 409')) });
    const audit = { record: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const permit = { check: jest.fn().mockResolvedValue(true) };
    const exec = new ToolExecutor({ getTool: () => tool, permit, audit });

    const result = await exec.execute(pending());

    expect(result).toMatchObject({ success: false, summary: 'backend 409' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ permitDecision: 'allowed', result: { error: 'backend 409' } }),
    );
  });

  it('never throws when the audit write fails', async () => {
    const tool = makeTool();
    const audit = { record: jest.fn().mockRejectedValue(new Error('db down')) };
    const permit = { check: jest.fn().mockResolvedValue(true) };
    const exec = new ToolExecutor({ getTool: () => tool, permit, audit });

    const result = await exec.execute(pending());
    expect(result.success).toBe(true);
  });
});
