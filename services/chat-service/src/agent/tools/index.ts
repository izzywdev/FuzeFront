// index.ts — agent tool registry (plan §6c).
//
// Registers the read-only `search_docs` tool and the three mutating tools
// (create_org, invite_member, update_settings). Mutating tools flow through the
// ConfirmationStore + PermitClient gate (see prepareMutatingTool + the
// /chat/confirm/:id route) before their execute() runs. The registry exposes
// lookup-by-name and a list for the agent loop to advertise tools to the model.

import type { AgentTool } from './types';
import type { Retriever } from '../../rag/retriever';
import type { BackendActionClient } from '../backend-client';
import { createSearchDocsTool } from './search-docs';
import { createCreateOrgTool } from './create-org';
import { createInviteMemberTool } from './invite-member';
import { createUpdateSettingsTool } from './update-settings';

export type { AgentTool, ToolContext, PermitMapping } from './types';

export interface ToolRegistryDeps {
  retriever: Pick<Retriever, 'retrieve'>;
  /** Backend client the mutating tools call to perform real platform actions. */
  backend: BackendActionClient;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<any, any>>();

  register(tool: AgentTool<any, any>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool<any, any>[] {
    return Array.from(this.tools.values());
  }
}

export function buildToolRegistry(deps: ToolRegistryDeps): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createSearchDocsTool(deps.retriever));
  // Mutating tools — gated by confirmation + Permit before execute().
  registry.register(createCreateOrgTool(deps.backend));
  registry.register(createInviteMemberTool(deps.backend));
  registry.register(createUpdateSettingsTool(deps.backend));
  return registry;
}
