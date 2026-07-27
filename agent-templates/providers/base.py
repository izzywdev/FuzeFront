"""Provider-agnostic agent-runtime interface.

An `AgentProvider` is the seam between the provider-neutral *definitions* (role
manifests, environments, vaults, memory) + *orchestration* (launch, relay, handoff)
and a specific backend (Anthropic Managed Agents today; OpenAI / Hermes next).

Everything above the seam speaks manifests + this interface; each provider
translates manifests into its own payloads and implements the runtime ops. The
approver contract and the {status: idle|blocked|error, pending} shape are shared
verbatim with the existing driver so no orchestration logic changes.
"""
from abc import ABC, abstractmethod


class AgentProvider(ABC):
    #: short id used by the registry / AGENT_PROVIDER env
    name = "base"
    #: what the backend supports; provisioning skips unsupported resource kinds
    capabilities = {"self_hosted": False, "vaults": False, "memory": False, "multiagent": False}

    # ---- provisioning (manifest in -> {name, id[, version]} out) -------------
    @abstractmethod
    def ensure_environment(self, manifest):
        """Create-if-missing an environment. Returns {'name', 'id'}."""

    @abstractmethod
    def ensure_agent(self, manifest, multiagent=None):
        """Create-or-update an agent from a (merged) role manifest. `multiagent`
        is an optional resolved roster [{id, version}, ...] for a coordinator.
        Returns {'name', 'id', 'version'}."""

    def ensure_vault(self, manifest):
        raise NotImplementedError(f"{self.name}: vaults not supported")

    def ensure_memory(self, manifest):
        raise NotImplementedError(f"{self.name}: memory stores not supported")

    # ---- runtime ------------------------------------------------------------
    @abstractmethod
    def create_session(self, agent_id, version, environment_id,
                       vault_ids=None, memory_resources=None, title=None):
        """Returns the session id."""

    @abstractmethod
    def send_message(self, session_id, text):
        """Send a user.message-equivalent event."""

    @abstractmethod
    def run_turn(self, session_id, prompt, approver, echo=True):
        """Drive one turn to completion, handling approvals via `approver`.
        Returns the accumulated agent text."""

    @abstractmethod
    def run_until_block(self, session_id, prompt=None):
        """Run until idle OR a required approval. Returns
        {'text', 'status': 'idle'|'blocked'|'error', 'pending': {...}|None}."""

    @abstractmethod
    def resume_session(self, session_id, summary, context_ref=""):
        """Wake an existing session with a concise summary (history restored server-side)."""

    @abstractmethod
    def confirm_tool(self, session_id, tool_use_id, allow=True, deny_message=None):
        """Answer a single always_ask pause."""

    @abstractmethod
    def archive_session(self, session_id):
        """Terminate a session (best-effort)."""

    # ---- memory (optional) --------------------------------------------------
    def memory_resource(self, store_id, access="read_write", instructions=None):
        raise NotImplementedError(f"{self.name}: memory stores not supported")

    def memory_write(self, store_id, path, content):
        raise NotImplementedError(f"{self.name}: memory stores not supported")

    def memory_read(self, store_id, path):
        raise NotImplementedError(f"{self.name}: memory stores not supported")


# ---- shared, provider-agnostic approvers ------------------------------------
# An approver maps {tool_use_id -> human description} to {tool_use_id -> (result, deny_message)}.

def interactive_approver(descriptions):
    out = {}
    for tid, desc in descriptions.items():
        ans = input(f"\nAPPROVE tool call?\n  {desc}\n  [y]allow / [n]deny > ").strip().lower()
        if ans in ("y", "yes", "allow"):
            out[tid] = ("allow", None)
        else:
            out[tid] = ("deny", input("  deny reason > ").strip() or "denied by operator")
    return out


def auto_approver(result):
    msg = None if result == "allow" else "auto-denied (headless)"
    return lambda descriptions: {tid: (result, msg) for tid in descriptions}
