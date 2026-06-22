// update-settings.ts — mutating tool: update organization settings (§6d).
//
// Permit mapping: resource 'organization', action 'update'. Mutating: flows
// through confirmation + Permit before execute(). execute() performs the real
// backend PUT and returns a tool_result summary.

import { z } from 'zod';
import type { AgentTool, ToolContext } from './types';
import type { BackendActionClient } from '../backend-client';
import type { MutatingToolContext, MutatingToolResult } from './create-org';

export const updateSettingsArgsSchema = z.object({
  orgId: z.string().min(1),
  settings: z.record(z.unknown()).refine((s) => Object.keys(s).length > 0, {
    message: 'settings must not be empty',
  }),
});

export type UpdateSettingsArgs = z.infer<typeof updateSettingsArgsSchema>;

export function createUpdateSettingsTool(
  backend: Pick<BackendActionClient, 'updateOrgSettings'>,
): AgentTool<UpdateSettingsArgs, MutatingToolResult> {
  return {
    name: 'update_settings',
    description:
      'Update settings for a FuzeFront organization. Requires confirmation. ' +
      'Args: orgId, settings (object of fields to change).',
    mutating: true,
    permit: { resource: 'organization', action: 'update' },
    async execute(args: UpdateSettingsArgs, ctx: ToolContext): Promise<MutatingToolResult> {
      const parsed = updateSettingsArgsSchema.parse(args);
      const token = (ctx as MutatingToolContext).token ?? '';
      await backend.updateOrgSettings(token, {
        orgId: parsed.orgId,
        settings: parsed.settings,
      });
      return {
        success: true,
        summary: `Updated settings for organization ${parsed.orgId}.`,
      };
    },
  };
}
