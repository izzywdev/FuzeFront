"""Provider registry for the agent framework.

    from providers import get_provider
    p = get_provider()            # AGENT_PROVIDER env, default "anthropic"
    p = get_provider("openai")    # explicit

Adapters are imported lazily so selecting one provider never pulls another's
(possibly missing) SDK. Add a provider by dropping providers/<name>/adapter.py
with a `<Name>Provider(AgentProvider)` and registering it here.
"""
import os

from providers.base import AgentProvider  # re-export for adapters/type hints

__all__ = ["get_provider", "AgentProvider", "PROVIDERS"]

PROVIDERS = ("anthropic", "openai", "hermes")


def get_provider(name=None):
    name = (name or os.environ.get("AGENT_PROVIDER") or "anthropic").strip().lower()
    if name == "anthropic":
        from providers.anthropic.adapter import AnthropicProvider
        return AnthropicProvider()
    if name == "openai":
        from providers.openai.adapter import OpenAIProvider
        return OpenAIProvider()
    if name == "hermes":
        from providers.hermes.adapter import HermesProvider
        return HermesProvider()
    raise ValueError(f"unknown provider '{name}' — known: {', '.join(PROVIDERS)}. "
                     f"See agent-templates/providers/<name>/adapter.py to add one.")
