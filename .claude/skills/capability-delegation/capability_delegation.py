"""Capability delegation — the deterministic pieces a caller and a callee share.

The parts of cross-session delegation that are *pure logic* — the message envelope, the
caller-side path selection, and the callee's fail-closed authorization check — live here so
every agent does them **identically** and they can be unit-tested offline. The transport
itself (spawning a session, firing a trigger to deliver a turn) is a set of
`claude-code-remote` MCP tool calls an agent makes from its own tool namespace; those are
documented step-by-step in this skill's `SKILL.md`. This module produces/validates the
payloads that flow through them.

This is the **generic, fleet-wide** helper (synced into every repo's `.claude/skills/` by
governance-sync). The one repo-specific input — *which environment owns which capability* —
is NOT hardcoded here: it is loaded from a repo-local registry file (`load_registry`), so
the same code serves every repo and each repo declares its own capability→environment map.

No third-party dependencies (stdlib only) so it imports in any sandbox and in CI.

Envelope (every delegated turn starts with this line):

    [A2A from=<sender session_id> corr=<uuid> reply_to=<sender session_id> cap=<capability>] <body>

CLI:

    python capability_delegation.py envelope  --from session_A --cap kubectl.read --body "get pods"
    python capability_delegation.py parse     "[A2A from=session_A corr=... cap=kubectl.read] get pods"
    python capability_delegation.py registry  [--cap kubectl.read] [--registry <path>]
    python capability_delegation.py authorize --from session_A --cap kubectl.read \
        --provides-to session_A --allow-cap kubectl.read
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from typing import Iterable, Optional


# --------------------------------------------------------------------------------------
# Registry (repo-specific data, not hardcoded here).
#
# A capability→environment registry maps each `cap=` token (a PRE-AGREED operation, never an
# arbitrary command) to the `environment_id` that OWNS its credential. Callers look a
# capability up and spawn a session in that environment; they never receive the credential.
# Each repo declares its own registry as JSON at one of REGISTRY_PATHS, shaped:
#
#   { "kubectl.read": {"environment": "selfhosted-devops", "read_only": true, "notes": "…"},
#     "github.secret.provision": {"environment": null, ...}   # null = not wired → don't delegate
#   }
# --------------------------------------------------------------------------------------
REGISTRY_PATHS = (
    "agent-templates/orchestration/capability-registry.json",
    ".fuze/capability-registry.json",
)


def load_registry(repo_root: Optional[str] = None, path: Optional[str] = None) -> dict:
    """Load the repo's capability→environment registry, or {} if none is declared.

    Returns {} (not an error) when no registry file exists — a caller MUST treat an unknown
    capability as "cannot delegate", so an absent registry fails closed by construction.
    """
    root = repo_root or os.getcwd()
    candidates = [path] if path else [os.path.join(root, p) for p in REGISTRY_PATHS]
    for cand in candidates:
        if cand and os.path.isfile(cand):
            with open(cand, encoding="utf-8") as f:
                data = json.load(f)
            # tolerate a top-level "$schema" / comment keys
            return {k: v for k, v in data.items() if not k.startswith("$")}
    return {}


def capability_environment(cap: str, registry: dict) -> Optional[str]:
    """The environment_id that owns `cap`, or None if unknown/not-wired.

    None is returned both for an unknown capability and for a known-but-unwired one
    (`environment: null`). A caller MUST treat None as "cannot delegate this yet", never as
    "delegate anywhere".
    """
    entry = registry.get(cap)
    return entry.get("environment") if isinstance(entry, dict) else None


# --------------------------------------------------------------------------------------
# Envelope
# --------------------------------------------------------------------------------------
# Header value tokens are non-whitespace AND non-`]` — so a body that itself contains a
# `]` (e.g. "bump image [v2]") can't be swallowed into the last header value.
_VAL = r"[^\]\s]+"
ENVELOPE_RE = re.compile(
    r"^\[A2A"
    rf"(?=[^\]]*\bfrom=(?P<frm>{_VAL}))"
    rf"(?=[^\]]*\bcorr=(?P<corr>{_VAL}))"
    rf"(?=[^\]]*\bcap=(?P<cap>{_VAL}))"
    rf"(?:[^\]]*\breply_to=(?P<reply_to>{_VAL}))?"
    r"[^\]]*\]\s?(?P<body>.*)$",
    re.DOTALL,
)


@dataclass
class Envelope:
    """A parsed / to-be-built delegation envelope."""

    frm: str
    cap: str
    body: str
    corr: str = field(default_factory=lambda: str(uuid.uuid4()))
    reply_to: Optional[str] = None

    def __post_init__(self) -> None:
        if self.reply_to is None:  # the callee fires its reply back at `from`
            self.reply_to = self.frm

    def render(self) -> str:
        return (
            f"[A2A from={self.frm} corr={self.corr} "
            f"reply_to={self.reply_to} cap={self.cap}] {self.body}"
        )


def build_envelope(
    frm: str,
    cap: str,
    body: str,
    corr: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> str:
    """Render the envelope line for a delegated turn. `corr` is generated if omitted."""
    if not frm or not cap:
        raise ValueError("both `from` (sender session_id) and `cap` are required")
    env = Envelope(frm=frm, cap=cap, body=body, reply_to=reply_to)
    if corr:
        env.corr = corr
    return env.render()


def parse_envelope(text: str) -> Optional[Envelope]:
    """Parse a delegated turn's opening envelope. Returns None if it isn't one.

    Order-independent for the header keys, and tolerant of a body that itself contains a
    ``]`` — only the header's own closing ``]`` ends the header.
    """
    if text is None:
        return None
    m = ENVELOPE_RE.match(text.strip())
    if not m:
        return None
    return Envelope(
        frm=m.group("frm"),
        cap=m.group("cap"),
        body=m.group("body"),
        corr=m.group("corr"),
        reply_to=m.group("reply_to") or m.group("frm"),
    )


# --------------------------------------------------------------------------------------
# Authorization (callee side) — fail-closed
# --------------------------------------------------------------------------------------
@dataclass
class Decision:
    allowed: bool
    reason: str

    def __bool__(self) -> bool:
        return self.allowed


def authorize(
    envelope: Optional[Envelope],
    provides_to: Iterable[str],
    allowed_caps: Iterable[str],
) -> Decision:
    """The CALLEE's fail-closed check. Default DENY.

    Honor a request only if BOTH hold:
      1. the sender (`envelope.frm`) is on `provides_to` — the callee-owned allowlist
         (`.fuze/manifest.json` `providesTo`, `[]` by default = accept no callers), and
      2. `envelope.cap` is one of `allowed_caps` — a pre-agreed, capability-scoped
         operation this callee honors (never an arbitrary command string).

    An empty `provides_to` denies everything (the fail-closed manifest default). This
    AUTHORIZES only; it never executes and never returns a credential — the caller of this
    function maps an allowed `cap` to its own vetted action and returns a result only.
    """
    provides_to = set(provides_to or ())
    allowed_caps = set(allowed_caps or ())

    if envelope is None:
        return Decision(False, "no envelope — refusing (fail-closed)")
    if not provides_to:
        return Decision(False, "providesTo is empty — accept no callers (fail-closed default)")
    if envelope.frm not in provides_to:
        return Decision(False, f"sender {envelope.frm!r} not on providesTo allowlist — refused")
    if envelope.cap not in allowed_caps:
        return Decision(
            False,
            f"capability {envelope.cap!r} not in this callee's allowed set — refused "
            "(capabilities are pre-agreed named operations, not arbitrary commands)",
        )
    return Decision(True, f"sender allowed and capability {envelope.cap!r} is honored")


# --------------------------------------------------------------------------------------
# Path selection (caller side) — keyed on where the CALLER runs
# --------------------------------------------------------------------------------------
def select_path(caller_is_local: bool) -> dict:
    """Which transport a caller uses, keyed on where the CALLER runs.

    Local/desktop → spawn a Claude Code session in the target environment by name:
    subscription/plan usage, no agent_id, the unblocked+cheaper path. Non-local →
    handoff-mcp `spawn_agent(role)`: API-billed, needs credit + populated id maps. Both
    carry the same envelope and the same fail-closed authz.
    """
    if caller_is_local:
        return {
            "path": "claude-code-session",
            "how": "spawn a Claude Code session in the target environment by name "
            "(desktop env picker) or create_session(environment_id=<owning env>)",
            "billing": "subscription/plan usage",
            "needs_agent_id": False,
        }
    return {
        "path": "handoff-mcp",
        "how": 'spawn_agent("<role>", task, reply_to_session_id=<self>)',
        "billing": "Anthropic API credit",
        "needs_agent_id": True,
    }


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------
def _main(argv: Optional[list] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pe = sub.add_parser("envelope", help="render a delegation envelope line")
    pe.add_argument("--from", dest="frm", required=True)
    pe.add_argument("--cap", required=True)
    pe.add_argument("--body", default="")
    pe.add_argument("--corr")
    pe.add_argument("--reply-to")

    pp = sub.add_parser("parse", help="parse an envelope line to JSON")
    pp.add_argument("text")

    pr = sub.add_parser("registry", help="show the repo's capability→environment registry")
    pr.add_argument("--cap", help="look up a single capability")
    pr.add_argument("--registry", help="explicit registry path (else the default search paths)")

    pa = sub.add_parser("authorize", help="run the fail-closed callee check")
    pa.add_argument("--from", dest="frm", required=True)
    pa.add_argument("--cap", required=True)
    pa.add_argument("--provides-to", nargs="*", default=[])
    pa.add_argument("--allow-cap", dest="allow_caps", nargs="*", default=[])

    args = p.parse_args(argv)

    if args.cmd == "envelope":
        print(build_envelope(args.frm, args.cap, args.body, corr=args.corr, reply_to=args.reply_to))
        return 0

    if args.cmd == "parse":
        env = parse_envelope(args.text)
        if env is None:
            print("not an A2A envelope", file=sys.stderr)
            return 1
        print(json.dumps(env.__dict__, indent=2))
        return 0

    if args.cmd == "registry":
        reg = load_registry(path=args.registry)
        if args.cap:
            entry = reg.get(args.cap)
            if entry is None:
                print(f"unknown capability {args.cap!r} (registry has {len(reg)} entries)", file=sys.stderr)
                return 1
            print(json.dumps({args.cap: entry}, indent=2))
            return 0
        print(json.dumps(reg, indent=2))
        return 0

    if args.cmd == "authorize":
        env = Envelope(frm=args.frm, cap=args.cap, body="")
        d = authorize(env, provides_to=args.provides_to, allowed_caps=args.allow_caps)
        print(json.dumps({"allowed": d.allowed, "reason": d.reason}, indent=2))
        return 0 if d.allowed else 2

    return 1


if __name__ == "__main__":
    raise SystemExit(_main())
