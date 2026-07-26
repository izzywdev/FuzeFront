"""Load role manifests, merge with _base, and render POST /v1/agents payloads.

The role .md persona body (YAML frontmatter stripped) becomes the agent `system`,
followed by the base guardrail block and any role-specific `system_append`.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_ROOT = os.path.dirname(HERE)                # agent-templates/
REPO_ROOT = os.path.dirname(TEMPLATES_ROOT)           # repo root (personas live under .claude/agents)
ROLES_DIR = os.path.join(TEMPLATES_ROOT, "roles")

_FRONTMATTER = re.compile(r"^\s*---\s*\n.*?\n---\s*\n", re.DOTALL)


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def strip_frontmatter(md_text):
    return _FRONTMATTER.sub("", md_text, count=1).strip()


def load_manifest(path):
    """Load a role/coordinator manifest, overlaying _base when `extends` is set."""
    manifest = _read_json(path)
    parent = manifest.get("extends")
    if not parent:
        return manifest
    base = _read_json(os.path.join(ROLES_DIR, parent, "role.json"))
    merged = dict(base)
    for k, v in manifest.items():
        if k in ("extends", "$schema"):
            continue
        merged[k] = v
    # base guardrail text is always kept; role adds to it rather than replacing.
    base_append = base.get("system_append", "")
    role_append = manifest.get("system_append", "")
    merged["system_append"] = "\n\n".join(p for p in (base_append, role_append) if p)
    # merge the informational services grants (role overrides per key)
    merged["services"] = {**base.get("services", {}), **manifest.get("services", {})}
    return merged


def resolve_system(manifest):
    """Compose the final `system` from persona .md + base/role guard text, or inline `system`."""
    parts = []
    persona = manifest.get("persona")
    if persona:
        persona_path = os.path.join(REPO_ROOT, persona)
        with open(persona_path, "r", encoding="utf-8") as f:
            parts.append(strip_frontmatter(f.read()))
    elif manifest.get("system"):
        parts.append(manifest["system"].strip())
    if manifest.get("system_append"):
        parts.append(manifest["system_append"].strip())
    return "\n\n".join(p for p in parts if p)


def agent_payload(manifest):
    """Render the POST /v1/agents body (without multiagent, filled by sync for coordinators)."""
    from common import expand_env

    payload = {
        "name": manifest["name"],
        "model": manifest.get("model", "claude-opus-4-8"),
        "system": resolve_system(manifest),
    }
    if manifest.get("description"):
        payload["description"] = manifest["description"]

    # Drop MCP servers whose URL isn't configured (env var unset -> literal "${VAR}",
    # or set-but-empty -> "") — the API rejects an empty/invalid url. Also drop the
    # matching mcp_toolset so the agent creates cleanly with only its configured servers;
    # re-provision after setting the URL to add the server + tool back.
    servers = expand_env(manifest.get("mcp_servers", []))
    valid, dropped = [], set()
    for s in servers:
        url = s.get("url", "")
        if url and "${" not in url:
            valid.append(s)
        else:
            dropped.add(s.get("name"))
    tools = expand_env(manifest.get("tools", []))
    if dropped:
        tools = [t for t in tools
                 if not (t.get("type") == "mcp_toolset" and t.get("mcp_server_name") in dropped)]
    if tools:
        payload["tools"] = tools
    if valid:
        payload["mcp_servers"] = valid
    if manifest.get("skills"):
        payload["skills"] = manifest["skills"]
    if manifest.get("metadata"):
        payload["metadata"] = manifest["metadata"]
    return payload


def role_dirs():
    """All role keys that have a roles/<role>/role.json (excluding _base)."""
    out = []
    for name in sorted(os.listdir(ROLES_DIR)):
        if name == "_base":
            continue
        if os.path.isfile(os.path.join(ROLES_DIR, name, "role.json")):
            out.append(name)
    return out
