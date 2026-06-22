// create-org.ts — mutating tool: create an organization (plan §6d).
//
// Permit mapping: resource 'organization', action 'create'. Being mutating, it
// flows through the confirmation gate + Permit check BEFORE execute() runs (see
// prepareMutatingTool + POST /chat/confirm/:id). execute() is the post-confirm
// step: it performs the real backend call and returns a tool_result summary.

import { z } from 'zod';
import type { AgentTool, ToolContext } from './types';
import type { BackendActionClient } from '../backend-client';

export const createOrgArgsSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
});

export type CreateOrgArgs = z.infer<typeof createOrgArgsSchema>;

export interface MutatingToolResult {
  success: boolean;
  summary: string;
}

/** The bearer token is threaded in via the tool context (added for mutating tools). */
export type MutatingToolContext = ToolContext & { token: string };

export function createCreateOrgTool(
  backend: Pick<BackendActionClient, 'createOrg'>,
): AgentTool<CreateOrgArgs, MutatingToolResult> {
  return {
    name: 'create_org',
    description:
      'Create a new FuzeFront organization. Requires confirmation. ' +
      'Args: name (display name), slug (url-safe id), description (optional).',
    mutating: true,
    permit: { resource: 'organization', action: 'create' },
    async execute(args: CreateOrgArgs, ctx: ToolContext): Promise<MutatingToolResult> {
      const parsed = createOrgArgsSchema.parse(args);
      const token = (ctx as MutatingToolContext).token ?? '';
      await backend.createOrg(token, {
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description,
      });
      return { success: true, summary: `Created organization "${parsed.name}".` };
    },
  };
}
