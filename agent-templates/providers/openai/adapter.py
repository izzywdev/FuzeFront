"""OpenAI provider — STUB.

Extension point for running the same role manifests on OpenAI instead of Anthropic
Managed Agents. Implement the methods below against OpenAI's primitives; the
manifests + orchestration above the `AgentProvider` seam do not change.

Concept mapping (Managed Agents -> OpenAI):
  agent            -> an Assistant (Assistants API) OR a reusable config for the
                      Responses API / Agents SDK (model + instructions + tools).
  agent `system`   -> Assistant `instructions`.
  tools / policies -> Assistant `tools` (function/code_interpreter/file_search);
                      always_ask -> your app gates the tool call before executing
                      (OpenAI has no server-side always_ask — approvals are client-side).
  environment      -> a code-interpreter container / your own sandbox; `packages`
                      -> preinstalled image or a setup step; networking -> your egress policy.
  session          -> a Thread (Assistants) or a Response chain (`previous_response_id`).
  run_turn         -> create+poll a Run / a Response; stream deltas.
  resume_session   -> continue the Thread / chain by id (history is server-side too).
  vaults           -> not a native concept; inject secrets via your tool layer.
  memory           -> a vector store (file_search) or your own store.

Until implemented, every method raises NotImplementedError with this guidance.
"""
from providers.base import AgentProvider

_MSG = ("OpenAI provider is a stub — implement providers/openai/adapter.py "
        "(see the module docstring for the Managed-Agents -> OpenAI mapping).")


class OpenAIProvider(AgentProvider):
    name = "openai"
    capabilities = {"self_hosted": True, "vaults": False, "memory": True, "multiagent": True}

    def ensure_environment(self, manifest): raise NotImplementedError(_MSG)
    def ensure_agent(self, manifest, multiagent=None): raise NotImplementedError(_MSG)
    def create_session(self, agent_id, version, environment_id, vault_ids=None, memory_resources=None, title=None): raise NotImplementedError(_MSG)
    def send_message(self, session_id, text): raise NotImplementedError(_MSG)
    def run_turn(self, session_id, prompt, approver, echo=True): raise NotImplementedError(_MSG)
    def run_until_block(self, session_id, prompt=None): raise NotImplementedError(_MSG)
    def resume_session(self, session_id, summary, context_ref=""): raise NotImplementedError(_MSG)
    def confirm_tool(self, session_id, tool_use_id, allow=True, deny_message=None): raise NotImplementedError(_MSG)
    def archive_session(self, session_id): raise NotImplementedError(_MSG)
