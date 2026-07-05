// mutating.ts — whitelisted mutating agent tools (plan §6c/§6d).
//
// These were DEFERRED in the backend scaffold; this module implements them.
// Each mutating tool:
//   - declares `mutating: true` and its Permit resource/action mapping,
//   - validates/normalizes its args,
//   - performs the real mutation via the PlatformClient (forwarding the JWT).
//
// They never execute inline: the agent loop registers a pending confirmation and
// the ToolExecutor runs them only after POST /chat/confirm/:id, behind a live
// Permit check, with an audit-log write (see executor.ts).

import type { AgentTool, ToolContext } from './types';
import type { PlatformClient } from './platform-client';

/** Context with the caller's bearer token, needed for backend mutations. */
export interface MutatingToolContext extends ToolContext {
  token: string;
}

/** Derive a URL-safe slug from an org name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export interface CreateOrgArgs {
  name: string;
}

export function createCreateOrgTool(
  platform: Pick<PlatformClient, 'createOrganization'>,
): AgentTool<CreateOrgArgs, { id: string; name: string }> {
  return {
    name: 'create_org',
    description: 'Create a new FuzeFront organization owned by the current user.',
    mutating: true,
    permit: { resource: 'organization', action: 'create' },
    async execute(args: CreateOrgArgs, ctx: ToolContext): Promise<{ id: string; name: string }> {
      const name = String(args?.name ?? '').trim();
      if (!name) throw new Error('create_org requires a non-empty "name".');
      const { token } = ctx as MutatingToolContext;
      return platform.createOrganization({ name, slug: slugify(name) }, token);
    },
  };
}

export interface UpdateSettingsArgs {
  /** Settings patch to apply to the caller's current org. */
  settings: Record<string, unknown>;
}

export function createUpdateSettingsTool(
  platform: Pick<PlatformClient, 'updateOrganizationSettings'>,
): AgentTool<UpdateSettingsArgs, { id: string }> {
  return {
    name: 'update_settings',
    description: "Update the current organization's settings.",
    mutating: true,
    permit: { resource: 'organization', action: 'update' },
    async execute(args: UpdateSettingsArgs, ctx: ToolContext): Promise<{ id: string }> {
      const patch = args?.settings;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('update_settings requires a "settings" object.');
      }
      const { token, orgId } = ctx as MutatingToolContext;
      if (!orgId) throw new Error('update_settings requires an organization context.');
      return platform.updateOrganizationSettings({ orgId, patch }, token);
    },
  };
}

/** Build the set of whitelisted mutating tools. */
export function buildMutatingTools(platform: PlatformClient): AgentTool<any, any>[] {
  return [createCreateOrgTool(platform), createUpdateSettingsTool(platform)];
}
