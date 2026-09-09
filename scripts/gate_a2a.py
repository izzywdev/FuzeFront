#!/usr/bin/env python3
"""gate-a2a — verify this repo's A2A (agent-to-agent) surface.

Checks four things a manifest declaration alone does not prove:

  I1  the declared image IS the shared canonical image (ghcr.io/izzywdev/fuze-a2a)
  I2  the declared tag actually resolves in the GHCR registry (anonymous manifest GET)
  S4  every name in a serving role's skills[] resolves to .claude/skills/<name>/SKILL.md
        4.1 — a named skill is absent   ALWAYS FATAL, never ratcheted
        4.2 — zero bundle skills on any serving role   governed by skills.adoption mode
        4.3 — root CLAUDE.md absent                    governed by skills.adoption mode
  C1  every secretRef {name, key} in the enabled a2a values block is wired to a
      SealedSecret that carries that key, OR declared externallyProvisioned with a reason
  D1  a2a.enabled=true appears in at least one values file with a full a2a: block

Policy file: governance/a2a-policy.json (seeded per-repo by sdlc-bootstrap; absence
             is NOT permissive — DEFAULT_POLICY applies and `fail` mode is the default).

Exit codes: 0 = clean   1 = violations   2 = usage/config error

Usage:
    python3 scripts/gate_a2a.py [root] [--all] [--image-only] [--skills-only]
                                        [--creds-only] [--deployment-only]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

try:
    import yaml  # type: ignore
    _HAVE_YAML = True
except ImportError:
    _HAVE_YAML = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SHARED_IMAGE = "ghcr.io/izzywdev/fuze-a2a"

DEFAULT_POLICY: dict[str, Any] = {
    "version": 1,
    "image": {
        "repository": SHARED_IMAGE,
    },
    "skills": {
        "adoption": "fail",
    },
    "creds": {
        "sealedSecretDirs": [
            "deploy/sealed-secrets",
            "helm/sealed-secrets",
            "deploy/helm/sealed-secrets",
        ],
        "externallyProvisioned": {},
    },
    "memory": {"mode": "client-only"},
    "apiSurface": {"mode": "mcp-only"},
}

POLICY_PATH = "governance/a2a-policy.json"
MANIFEST_PATH = os.path.join(".fuze", "manifest.json")

VALUES_FILES = [
    "values.yaml",
    "values-prod.yaml",
    "values-local.yaml",
]
CHART_DIR = os.path.join("deploy", "helm", "fuzefront")

SKILLS_DIR = os.path.join(".claude", "skills")
ROLES_DIR = os.path.join("agent-templates", "roles")

GHCR_AUTH_URL = "https://ghcr.io/token?service=ghcr.io&scope=repository:{owner}/{name}:pull"
GHCR_MANIFEST_URL = "https://ghcr.io/v2/{owner}/{name}/manifests/{tag}"

PRUNE_DIRS = {".git", "node_modules", "dist", "build", ".venv", "__pycache__", ".turbo", "out"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _read_yaml(path: str) -> Any:
    if _HAVE_YAML:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    # Minimal fallback: read as JSON if yaml not available (won't work for YAML)
    raise RuntimeError(f"PyYAML not available — cannot parse {path}")


def _read_values(path: str) -> Any:
    """Parse a YAML values file; return None if it fails."""
    try:
        return _read_yaml(path)
    except Exception:
        return None


def load_policy(root: str) -> dict[str, Any]:
    policy = dict(DEFAULT_POLICY)
    policy_path = os.path.join(root, POLICY_PATH)
    if not os.path.isfile(policy_path):
        return policy
    try:
        data = _read_json(policy_path)
        # Shallow merge: each top-level key replaces the default entirely.
        for k, v in data.items():
            if k.startswith("$"):
                continue
            if k in policy and isinstance(policy[k], dict) and isinstance(v, dict):
                merged = dict(policy[k])
                merged.update({kk: vv for kk, vv in v.items() if not kk.startswith("$")})
                policy[k] = merged
            else:
                policy[k] = v
    except Exception as e:
        print(f"[gate-a2a] WARNING: could not load {POLICY_PATH}: {e}", file=sys.stderr)
    return policy


def load_manifest(root: str) -> dict | None:
    path = os.path.join(root, MANIFEST_PATH)
    if not os.path.isfile(path):
        return None
    return _read_json(path)


def load_role(root: str, role_name: str) -> dict | None:
    path = os.path.join(root, ROLES_DIR, role_name, "role.json")
    if not os.path.isfile(path):
        return None
    return _read_json(path)


def find_sealed_secrets(root: str, dirs: list[str]) -> dict[str, set[str]]:
    """Return {secret_name: {key, ...}} for all SealedSecrets found in dirs."""
    result: dict[str, set[str]] = {}
    for d in dirs:
        dirpath = os.path.join(root, d)
        if not os.path.isdir(dirpath):
            continue
        for fn in os.listdir(dirpath):
            if not fn.endswith((".yaml", ".yml")):
                continue
            fpath = os.path.join(dirpath, fn)
            try:
                doc = _read_yaml(fpath)
                if not isinstance(doc, dict):
                    continue
                if doc.get("kind") != "SealedSecret":
                    continue
                name = (doc.get("metadata") or {}).get("name", "")
                keys = set((doc.get("spec") or {}).get("encryptedData") or {})
                if name:
                    result.setdefault(name, set()).update(keys)
            except Exception:
                pass
    return result


def _assert_ghcr_url(url: str) -> None:
    """Raise ValueError for any URL that is not https://ghcr.io/…

    Semgrep flags dynamic urllib calls because urllib accepts file:// schemes.
    The URLs here come from hardcoded templates, but explicit validation is the
    right defense-in-depth rather than a suppression comment.
    """
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "ghcr.io":
        raise ValueError(f"gate_a2a: refusing non-GHCR URL: {url!r}")


def ghcr_token(owner: str, name: str) -> str | None:
    url = GHCR_AUTH_URL.format(owner=owner, name=name)
    _assert_ghcr_url(url)
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            data = json.loads(resp.read())
            return data.get("token")
    except Exception:
        return None


def ghcr_resolve_tag(repository: str, tag: str) -> tuple[bool, str]:
    """Returns (resolved, reason). resolved=True means the tag exists in registry."""
    if not repository.startswith("ghcr.io/"):
        return False, f"repository does not start with ghcr.io/: {repository}"
    rest = repository[len("ghcr.io/"):]
    parts = rest.split("/", 1)
    if len(parts) != 2:
        return False, f"cannot parse owner/name from: {repository}"
    owner, name = parts
    token = ghcr_token(owner, name)
    headers: dict[str, str] = {
        # Broad accept covers OCI image index, OCI manifest, Docker v2 manifest — GHCR
        # returns 404 when only one specific media type is requested but the stored artifact
        # is a different type (e.g. OCI index vs Docker manifest v2). The wildcard fallback
        # ensures any valid image manifest type is accepted.
        "Accept": (
            "application/vnd.oci.image.index.v1+json, "
            "application/vnd.oci.image.manifest.v1+json, "
            "application/vnd.docker.distribution.manifest.v2+json, "
            "*/*"
        ),
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = GHCR_MANIFEST_URL.format(owner=owner, name=name, tag=tag)
    _assert_ghcr_url(url)
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310  # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
            return resp.status == 200, "ok"
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, f"tag {tag!r} not found (404) in {repository}"
        return False, f"HTTP {e.code} resolving {repository}:{tag}"
    except Exception as ex:
        return None, f"registry unreachable: {ex}"  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

class Finding:
    def __init__(self, code: str, message: str, fatal: bool = True):
        self.code = code
        self.message = message
        self.fatal = fatal

    def __str__(self) -> str:
        sev = "ERROR" if self.fatal else "WARN"
        return f"[{sev}] {self.code}: {self.message}"


def check_image(root: str, policy: dict) -> list[Finding]:
    findings: list[Finding] = []
    # Locate values-prod.yaml (the authoritative enabled values).
    values_prod_path = os.path.join(root, CHART_DIR, "values-prod.yaml")
    if not os.path.isfile(values_prod_path):
        findings.append(Finding("I0", f"values-prod.yaml not found at {values_prod_path}"))
        return findings

    values = _read_values(values_prod_path)
    if not values:
        findings.append(Finding("I0", "values-prod.yaml could not be parsed"))
        return findings

    a2a = values.get("a2a") or {}
    if not a2a.get("enabled"):
        # Not enabled in prod — D1 will catch this if manifest says enabled.
        return findings

    image = a2a.get("image") or {}
    repo = image.get("repository", "")
    tag = image.get("tag", "")

    expected_repo = policy.get("image", {}).get("repository", SHARED_IMAGE)

    if repo != expected_repo:
        findings.append(Finding(
            "I1",
            f"image.repository is {repo!r}, expected {expected_repo!r} (the shared canonical image). "
            "Never build a second A2A image — per-product variation is config-only.",
        ))

    if not tag:
        findings.append(Finding("I2", "image.tag is empty in values-prod.yaml"))
        return findings

    resolved, reason = ghcr_resolve_tag(repo, tag)
    if resolved is None:
        findings.append(Finding("I2", f"UNVERIFIED: {reason}", fatal=False))
    elif not resolved:
        findings.append(Finding("I2", f"image tag {repo}:{tag} does not resolve in registry: {reason}"))

    return findings


def check_skills(root: str, manifest: dict, policy: dict) -> list[Finding]:
    findings: list[Finding] = []
    adoption_mode = (policy.get("skills") or {}).get("adoption", "fail")
    a2a_block = manifest.get("a2a") or {}
    serving_roles = a2a_block.get("servingRoles") or []

    # 4.3 — root CLAUDE.md
    if not os.path.isfile(os.path.join(root, "CLAUDE.md")):
        msg = "root CLAUDE.md is absent (rule 4.3)"
        findings.append(Finding("S4.3", msg, fatal=(adoption_mode == "fail")))

    for role_name in serving_roles:
        role = load_role(root, role_name)
        if role is None:
            findings.append(Finding("S4", f"serving role {role_name!r} has no role.json"))
            continue

        skills = role.get("skills") or []

        # 4.2 — zero bundle skills
        if not skills:
            msg = f"role {role_name!r} declares zero bundle skills (rule 4.2)"
            findings.append(Finding("S4.2", msg, fatal=(adoption_mode == "fail")))
            continue

        # 4.1 — named skill must resolve (ALWAYS FATAL)
        for skill_name in skills:
            skill_path = os.path.join(root, SKILLS_DIR, skill_name, "SKILL.md")
            if not os.path.isfile(skill_path):
                findings.append(Finding(
                    "S4.1",
                    f"role {role_name!r} lists skill {skill_name!r} but {skill_path} does not exist — ALWAYS FATAL",
                    fatal=True,
                ))

    return findings


def check_creds(root: str, policy: dict) -> list[Finding]:
    findings: list[Finding] = []
    creds_policy = policy.get("creds") or {}
    sealed_dirs = creds_policy.get("sealedSecretDirs") or []
    externally = creds_policy.get("externallyProvisioned") or {}

    sealed = find_sealed_secrets(root, sealed_dirs)

    values_prod_path = os.path.join(root, CHART_DIR, "values-prod.yaml")
    values = _read_values(values_prod_path) if os.path.isfile(values_prod_path) else None
    if not values:
        return findings

    a2a = values.get("a2a") or {}
    if not a2a.get("enabled"):
        return findings

    # Collect all secretRef {name, key} pairs from the a2a block.
    refs: list[tuple[str, str, str]] = []  # (name, key, location)

    def _collect(obj: Any, path: str) -> None:
        if not isinstance(obj, dict):
            return
        if "name" in obj and "key" in obj and isinstance(obj["name"], str) and isinstance(obj["key"], str):
            n, k = obj["name"], obj["key"]
            if n and k:
                refs.append((n, k, path))
        for kk, vv in obj.items():
            if kk.startswith("$"):
                continue
            if isinstance(vv, dict):
                _collect(vv, f"{path}.{kk}")
            elif isinstance(vv, list):
                for i, item in enumerate(vv):
                    _collect(item, f"{path}[{i}]")

    _collect(a2a, "a2a")

    a2a_deploy = values.get("a2aDeploy") or {}
    _collect(a2a_deploy, "a2aDeploy")

    for name, key, loc in refs:
        if name in externally:
            continue  # declared externally-provisioned
        if name not in sealed:
            findings.append(Finding(
                "C1",
                f"secretRef {{name: {name!r}, key: {key!r}}} at {loc} has no matching SealedSecret in {sealed_dirs}",
            ))
        elif key not in sealed[name]:
            findings.append(Finding(
                "C1",
                f"secretRef {{name: {name!r}, key: {key!r}}} at {loc}: SealedSecret {name!r} exists but key {key!r} is absent "
                f"(known keys: {sorted(sealed[name])})",
            ))

    return findings


def check_deployment(root: str, manifest: dict) -> list[Finding]:
    findings: list[Finding] = []
    # Find any values file where a2a.enabled=true exists with a real a2a: block.
    enabled_found = False
    chart_dir = os.path.join(root, CHART_DIR)
    if not os.path.isdir(chart_dir):
        findings.append(Finding("D1", f"Helm chart directory not found: {chart_dir}"))
        return findings

    for fn in VALUES_FILES:
        fpath = os.path.join(chart_dir, fn)
        if not os.path.isfile(fpath):
            continue
        values = _read_values(fpath)
        if not values:
            continue
        a2a = values.get("a2a") or {}
        if a2a.get("enabled"):
            enabled_found = True
            # Verify inClusterUrl is set.
            if not a2a.get("inClusterUrl"):
                findings.append(Finding(
                    "D1",
                    f"{fn}: a2a.enabled=true but inClusterUrl is unset. "
                    "A per-product pod without inClusterUrl publishes the shared server's card URL — "
                    "every caller follows that card to the wrong pod while all health signals stay green.",
                ))

    if not enabled_found:
        findings.append(Finding(
            "D1",
            f"manifest declares a2a.enabled=true but no chart values file in {CHART_DIR} has a2a.enabled=true with a full a2a: block. "
            "The declared surface exists nowhere. Add the a2a: block to values-prod.yaml.",
        ))

    # Template must exist.
    template = os.path.join(root, CHART_DIR, "templates", "a2a.yaml")
    if not os.path.isfile(template):
        findings.append(Finding("D1", f"Helm template not found: {template}"))

    return findings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Verify this repo's A2A surface.")
    parser.add_argument("root", nargs="?", default=".", help="Repo root (default: .)")
    parser.add_argument("--all", action="store_true", help="Run all checks (default)")
    parser.add_argument("--image-only", action="store_true")
    parser.add_argument("--skills-only", action="store_true")
    parser.add_argument("--creds-only", action="store_true")
    parser.add_argument("--deployment-only", action="store_true")
    args = parser.parse_args()

    root = os.path.realpath(args.root)
    run_all = args.all or not any([args.image_only, args.skills_only, args.creds_only, args.deployment_only])
    run_image = run_all or args.image_only
    run_skills = run_all or args.skills_only
    run_creds = run_all or args.creds_only
    run_deployment = run_all or args.deployment_only

    policy = load_policy(root)
    manifest = load_manifest(root)

    if manifest is None:
        print(f"[gate-a2a] ERROR: {MANIFEST_PATH} not found at {root}", file=sys.stderr)
        return 2

    a2a_block = manifest.get("a2a") or {}
    if not a2a_block.get("enabled"):
        print("[gate-a2a] a2a.enabled not declared — nothing to verify. Skipping is correct: there is no surface.")
        return 0

    all_findings: list[Finding] = []

    if run_image:
        all_findings.extend(check_image(root, policy))
    if run_skills:
        all_findings.extend(check_skills(root, manifest, policy))
    if run_creds:
        all_findings.extend(check_creds(root, policy))
    if run_deployment:
        all_findings.extend(check_deployment(root, manifest))

    fatals = [f for f in all_findings if f.fatal]
    warns = [f for f in all_findings if not f.fatal]

    for f in all_findings:
        print(f)

    if fatals:
        print(f"\n[gate-a2a] FAIL — {len(fatals)} fatal finding(s), {len(warns)} warning(s)")
        return 1

    if warns:
        print(f"\n[gate-a2a] PASS (with {len(warns)} warning(s))")
    else:
        print("\n[gate-a2a] PASS — A2A surface verified clean")

    return 0


if __name__ == "__main__":
    sys.exit(main())
