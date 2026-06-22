// invite-member.ts — mutating tool: invite a member to an organization (§6d).
//
// Permit mapping: resource 'organization', action 'invite'. Mutating: flows
// through confirmation + Permit before execute(). execute() performs the real
// backend invitation call and returns a tool_result summary.

import { z } from 'zod';
import type { AgentTool, ToolContext } from './types';
import type { BackendActionClient } from '../backend-client';
import type { MutatingToolContext, MutatingToolResult } from './create-org';

export const inviteMemberArgsSchema = z.object({
  orgId: z.string().min(1),
  email: z.string().email(),
  role: z.string().min(1),
});

export type InviteMemberArgs = z.infer<typeof inviteMemberArgsSchema>;

export function createInviteMemberTool(
  backend: Pick<BackendActionClient, 'inviteMember'>,
): AgentTool<InviteMemberArgs, MutatingToolResult> {
  return {
    name: 'invite_member',
    description:
      'Invite a member to a FuzeFront organization by email. Requires confirmation. ' +
      'Args: orgId, email, role.',
    mutating: true,
    permit: { resource: 'organization', action: 'invite' },
    async execute(args: InviteMemberArgs, ctx: ToolContext): Promise<MutatingToolResult> {
      const parsed = inviteMemberArgsSchema.parse(args);
      const token = (ctx as MutatingToolContext).token ?? '';
      await backend.inviteMember(token, {
        orgId: parsed.orgId,
        email: parsed.email,
        role: parsed.role,
      });
      return {
        success: true,
        summary: `Invited ${parsed.email} as ${parsed.role}.`,
      };
    },
  };
}
