// index.ts — agent tool registry (plan §6c).
//
// Only the read-only `search_docs` tool is registered for now. The mutating
// tools (create_org, invite_member, update_settings) are DEFERRED per the task
// brief; when added they register here and flow through the ConfirmationStore +
// PermitClient gate. The registry exposes lookup-by-name and a list for the
// agent loop to advertise available tools to the model.

import type { AgentTool } from './types';
import type { Retriever } from '../../rag/retriever';
import { createSearchDocsTool } from './search-docs';

export type { AgentTool, ToolContext, PermitMapping } from './types';

export interface ToolRegistryDeps {
  retriever: Pick<Retriever, 'retrieve'>;
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
  // DEFERRED: registry.register(createCreateOrgTool(...)) etc. (mutating tools)
  return registry;
}
