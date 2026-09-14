"""Hermes provider — STUB.

Extension point for running the same role manifests on a Hermes-based / OpenAI-
compatible agent runtime (e.g. NousResearch Hermes models served behind an
OpenAI-compatible or custom tool-calling API). Implement against whichever runtime
hosts Hermes; the manifests + orchestration above the `AgentProvider` seam are unchanged.

Concept mapping (Managed Agents -> Hermes runtime):
  agent            -> a model + system prompt + tool schema (Hermes uses its own
                      tool-call/function-calling format; translate manifest tools to it).
  agent `system`   -> the system prompt.
  tools / policies -> the tool schema you expose to the model; always_ask -> gate
                      execution in your harness (no server-side approval primitive).
  environment      -> your own sandbox/container (Hermes has no managed sandbox);
                      `packages` -> your image; networking -> your egress policy.
  session          -> your own conversation store keyed by id (persist server-side
                      to keep the "resume by id, don't copy transcript" property).
  run_turn         -> your inference + tool loop.
  resume_session   -> reload the stored conversation by id and continue.
  vaults / memory  -> your own secret store / vector store.

Until implemented, every method raises NotImplementedError with this guidance.
"""
from providers.base import AgentProvider

_MSG = ("Hermes provider is a stub — implement providers/hermes/adapter.py "
        "(see the module docstring for the Managed-Agents -> Hermes mapping).")


class HermesProvider(AgentProvider):
    name = "hermes"
    capabilities = {"self_hosted": True, "vaults": False, "memory": False, "multiagent": False}

    def ensure_environment(self, manifest): raise NotImplementedError(_MSG)
    def ensure_agent(self, manifest, multiagent=None): raise NotImplementedError(_MSG)
    def create_session(self, agent_id, version, environment_id, vault_ids=None, memory_resources=None, title=None): raise NotImplementedError(_MSG)
    def send_message(self, session_id, text): raise NotImplementedError(_MSG)
    def run_turn(self, session_id, prompt, approver, echo=True): raise NotImplementedError(_MSG)
    def run_until_block(self, session_id, prompt=None): raise NotImplementedError(_MSG)
    def resume_session(self, session_id, summary, context_ref=""): raise NotImplementedError(_MSG)
    def confirm_tool(self, session_id, tool_use_id, allow=True, deny_message=None): raise NotImplementedError(_MSG)
    def archive_session(self, session_id): raise NotImplementedError(_MSG)
