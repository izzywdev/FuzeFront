#!/usr/bin/env python3
"""gate-platform-org-pin — production may only carry the pinned platform org id.

WHY THIS EXISTS
---------------
selection-list-service takes its platform organization from the env var
SELECTION_LIST_PLATFORM_ORG_ID, rendered from the Helm value
`selectionListService.platformOrgId`. The platform organization is the one
tenant whose operators may publish a COMMON (global) list to every other
organization. The value is deliberately configurable per environment (local
clusters use their own ids), but in PRODUCTION it must only ever be the
immutable root platform organization. Otherwise a typo, or a mistaken or
malicious chart edit, hands global-publish power to an ordinary org, and
nothing in `helm lint` / `kubeconform` can notice: any string is schema-valid.

The single source of truth for the pin is `governance/platform-org-pin.json`
(NOT a constant in this file). Changing it is a reviewed, owner-approved PR.

WHAT IT CHECKS (production overlay only; other overlays are never read)
-----------------------------------------------------------------------
  pin-file          the pin file parses, declares the TypeID + UUID, and the two
                    agree (the TypeID is the base32 encoding of the UUID).
  overlay-literal   if values-prod.yaml sets selectionListService.platformOrgId
                    it is a string that is "" or EXACTLY the pinned id.
  effective-values  values.yaml deep-merged with values-prod.yaml (Helm merge
                    semantics): `enabled` is a real boolean, `platformOrgId` is a
                    string, and
                      * enabled=false -> "" or the pinned id is allowed
                        (rule `disabled-empty-or-pinned`; empty = platform
                        features fail closed, by design);
                      * enabled=true  -> the pinned id is REQUIRED
                        (rule `enabled-requires-pinned`; an enabled prod
                        service with no platform org is an explicit failure,
                        never a silent fail-closed deploy).
  rendered          `helm template` with the production overlay, exactly as
                    deployed: every SELECTION_LIST_PLATFORM_ORG_ID in the output
                    is a literal equal to the pinned id, the Deployment is
                    present iff the effective `enabled` says so, and there is
                    exactly one env entry per rendered selection-list Deployment.
  rendered-forced   the same render with the service forced ON (a probe only,
                    never deployed): the env is either "" or the pinned id, so a
                    template or an override elsewhere cannot smuggle in a
                    different value that only appears at enablement.

COMPARISON IS STRICT AND UNCOERCED
----------------------------------
`==` on the exact string. The bare UUID form, other case, and surrounding
whitespace are all rejected (and named in the message): the service expects the
canonical TypeID. No default, int/str coercion, or trimming is applied to any
value read from the chart (CLAUDE.md "Helm values hygiene"): a missing key, a
null, or a non-string is a failure, not a silent "".

FAIL CLOSED
-----------
A missing/unparsable pin file, values file, or chart; a duplicate YAML key; a
`helm` that is absent or fails to render; or rendered output that cannot be
parsed is a FAILURE, never a skip.

Usage (from the repo root):
  python3 scripts/gate_platform_org_pin.py
  python3 scripts/gate_platform_org_pin.py --chart deploy/helm/fuzefront \
      --pin governance/platform-org-pin.json --overlay values-prod.yaml
Exit status: 0 = pass, 1 = violation(s), 2 = usage error.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path

import yaml

ENV_VAR = "SELECTION_LIST_PLATFORM_ORG_ID"
VALUES_KEY = ("selectionListService", "platformOrgId")
ENABLED_KEY = ("selectionListService", "enabled")
SERVICE_BLOCK = "selectionListService"

# Placeholders the chart's OIDC render guard needs; identical to helm-validate.yml.
# They do not touch selectionListService.
HELM_BASE_ARGS = [
    "--set", 'secret.existingSecret=',
    "--set", "secret.authentikClientSecret=ci-placeholder",
]

_CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
_TYPEID_RE = re.compile(r"^org_[0-7][0-9a-hjkmnp-tv-z]{25}$")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class GateError(Exception):
    """A violation or an inability to evaluate. Both fail the gate."""


# --------------------------------------------------------------------------- yaml
class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that rejects duplicate mapping keys instead of keeping the last."""


def _construct_mapping(loader: _StrictLoader, node: yaml.MappingNode, deep: bool = False):
    seen = set()
    for key_node, _ in node.value:
        if key_node.tag == "tag:yaml.org,2002:merge":
            continue  # `<<: *anchor` may legitimately repeat; resolved by the base loader
        key = loader.construct_object(key_node, deep=deep)
        try:
            hash(key)
        except TypeError:
            raise GateError(f"unhashable YAML mapping key at line {key_node.start_mark.line + 1}")
        if key in seen:
            raise GateError(
                f"duplicate YAML key {key!r} at line {key_node.start_mark.line + 1}"
            )
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


def _construct_yaml_map(loader: _StrictLoader, node: yaml.MappingNode):
    data = {}
    yield data
    data.update(_construct_mapping(loader, node, deep=True))


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_yaml_map
)


def _load_yaml_file(path: Path):
    if not path.is_file():
        raise GateError(f"{path} does not exist")
    try:
        return yaml.load(path.read_text(encoding="utf-8"), Loader=_StrictLoader)  # noqa: S506 (safe loader subclass)
    except GateError as e:
        raise GateError(f"{path}: {e}")
    except (yaml.YAMLError, OSError, UnicodeDecodeError) as e:
        raise GateError(f"{path} is not parseable YAML: {e}")


# ----------------------------------------------------------------------- typeid
def decode_org_typeid(value: str) -> uuid.UUID:
    """Decode a canonical lowercase `org_<26 base32>` TypeID to its UUID."""
    if not isinstance(value, str) or not _TYPEID_RE.match(value):
        raise GateError(f"{value!r} is not a canonical lowercase org_ TypeID")
    n = 0
    for ch in value[len("org_"):]:
        n = n * 32 + _CROCKFORD.index(ch)
    return uuid.UUID(int=n)


# -------------------------------------------------------------------------- pin
def load_pin(pin_path: Path) -> dict:
    if not pin_path.is_file():
        raise GateError(f"pin file {pin_path} is missing")
    try:
        data = json.loads(pin_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as e:
        raise GateError(f"pin file {pin_path} is not valid JSON: {e}")
    if not isinstance(data, dict):
        raise GateError(f"pin file {pin_path} must be a JSON object")
    for key in ("pinnedPlatformOrgId", "pinnedPlatformOrgUuid", "owner", "rationale"):
        v = data.get(key)
        if not isinstance(v, str) or not v.strip():
            raise GateError(f"pin file {pin_path}: {key!r} is missing or empty")
    pin = data["pinnedPlatformOrgId"]
    pin_uuid = data["pinnedPlatformOrgUuid"]
    if not _UUID_RE.match(pin_uuid) or pin_uuid != pin_uuid.lower():
        raise GateError(f"pin file: pinnedPlatformOrgUuid {pin_uuid!r} is not a lowercase UUID")
    decoded = decode_org_typeid(pin)  # raises on a malformed TypeID
    if str(decoded) != pin_uuid:
        raise GateError(
            f"pin file is inconsistent: {pin!r} decodes to {decoded}, "
            f"but pinnedPlatformOrgUuid is {pin_uuid}"
        )
    return data


# ---------------------------------------------------------------- value helpers
def _lookup(tree, path, what):
    """Strict lookup: a missing key is an error, never a default."""
    cur = tree
    walked = []
    for part in path:
        walked.append(part)
        if not isinstance(cur, dict) or part not in cur:
            raise GateError(f"{what}: key {'.'.join(walked)} is not declared")
        cur = cur[part]
    return cur


def deep_merge(base, overlay):
    """Helm values merge: maps merge recursively, anything else replaces, null deletes."""
    out = dict(base)
    for k, v in overlay.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def describe_mismatch(value: str, pin: str, pin_uuid: str) -> str:
    """Explain WHY a non-pinned string is not the pin (diagnostic only; never accepted)."""
    if value.strip() != value:
        return "has leading/trailing whitespace"
    if value.lower() == pin_uuid.lower():
        return "is the bare UUID form; the service expects the canonical TypeID"
    if value.lower() == pin.lower():
        return "differs from the pin only by letter case"
    if value == "":
        return "is empty"
    return "is not the pinned platform organization"


# ------------------------------------------------------------------------ helm
def helm_template(chart: Path, overlay: Path, helm: str, extra: list[str]) -> list[dict]:
    cmd = [helm, "template", "fuzefront", str(chart), "-f", str(overlay), *HELM_BASE_ARGS, *extra]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        raise GateError(f"{helm!r} not found: cannot render the chart (fail closed, not skipped)")
    except subprocess.TimeoutExpired:
        raise GateError("helm template timed out (fail closed)")
    if proc.returncode != 0:
        raise GateError(f"`helm template` failed (exit {proc.returncode}): {proc.stderr.strip()[:800]}")
    try:
        docs = [d for d in yaml.safe_load_all(proc.stdout) if d is not None]
    except yaml.YAMLError as e:
        raise GateError(f"rendered chart is not parseable YAML: {e}")
    if not docs:
        raise GateError("helm template rendered no documents (fail closed)")
    return docs, proc.stdout


def collect_env_entries(node, found: list, where: str = "$"):
    """Every SELECTION_LIST_PLATFORM_ORG_ID anywhere in a rendered doc.

    Collected as (where, kind, value): env entries `{name: VAR, value: x}`,
    `{name: VAR, valueFrom: ...}` and plain mapping keys `VAR: x` (ConfigMap data).
    """
    if isinstance(node, dict):
        if node.get("name") == ENV_VAR:
            if "valueFrom" in node:
                found.append((where, "valueFrom", None))
            else:
                found.append((where, "value", node.get("value")))
        for k, v in node.items():
            if k == ENV_VAR:
                found.append((where, "key", v))
            collect_env_entries(v, found, f"{where}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            collect_env_entries(v, found, f"{where}[{i}]")


def selection_list_deployments(docs: list[dict]) -> list[dict]:
    out = []
    for d in docs:
        if not isinstance(d, dict) or d.get("kind") != "Deployment":
            continue
        name = (d.get("metadata") or {}).get("name", "")
        if name.endswith("selection-list-service"):
            out.append(d)
    return out


def _uncommented_mentions(raw: str) -> int:
    return sum(
        1
        for line in raw.splitlines()
        if ENV_VAR in line and not line.lstrip().startswith("#")
    )


def check_render(docs, raw, label, pin, pin_uuid, require_pinned, violations, notes):
    """Validate one render. `require_pinned`: env must equal the pin (service ON in prod)."""
    entries: list = []
    for d in docs:
        collect_env_entries(d, entries)
    if _uncommented_mentions(raw) != len(entries):
        violations.append(
            f"[{label}] {ENV_VAR} appears {_uncommented_mentions(raw)}x in the rendered "
            f"output but only {len(entries)} are structured env/data entries: it is wired "
            "in a form this gate cannot read (fail closed)"
        )
    for where, kind, value in entries:
        if kind == "valueFrom":
            violations.append(
                f"[{label}] {ENV_VAR} at {where} uses valueFrom; production must carry the "
                "pinned id as a literal so it can be verified"
            )
            continue
        if not isinstance(value, str):
            violations.append(f"[{label}] {ENV_VAR} at {where} is {value!r}, not a string")
            continue
        if value == pin:
            continue
        if value == "" and not require_pinned:
            continue
        why = describe_mismatch(value, pin, pin_uuid)
        violations.append(
            f"[{label}] {ENV_VAR} at {where} = {value!r} {why} "
            f"(expected exactly {pin!r}{'' if require_pinned else ' or empty'})"
        )
    return entries


# ------------------------------------------------------------------------- gate
def run_gate(chart: Path, pin_path: Path, overlay_name: str, helm: str):
    violations: list[str] = []
    notes: list[str] = []

    pin_data = load_pin(pin_path)
    pin = pin_data["pinnedPlatformOrgId"]
    pin_uuid = pin_data["pinnedPlatformOrgUuid"]
    notes.append(f"pin: {pin} (UUID {pin_uuid}), owner {pin_data['owner']}, from {pin_path}")

    defaults_path = chart / "values.yaml"
    overlay_path = chart / overlay_name
    defaults = _load_yaml_file(defaults_path)
    overlay = _load_yaml_file(overlay_path)
    for name, tree in ((defaults_path, defaults), (overlay_path, overlay)):
        if not isinstance(tree, dict):
            raise GateError(f"{name} is not a YAML mapping")

    # overlay-literal ----------------------------------------------------------
    svc_overlay = overlay.get(SERVICE_BLOCK)
    overlay_has_value = isinstance(svc_overlay, dict) and VALUES_KEY[1] in svc_overlay
    if overlay_has_value:
        lit = svc_overlay[VALUES_KEY[1]]
        if not isinstance(lit, str):
            violations.append(
                f"[overlay-literal] {overlay_name}: selectionListService.platformOrgId is "
                f"{lit!r} ({type(lit).__name__}), must be a string"
            )
        elif lit not in ("", pin):
            violations.append(
                f"[overlay-literal] {overlay_name}: selectionListService.platformOrgId = "
                f"{lit!r} {describe_mismatch(lit, pin, pin_uuid)}; production may only be "
                f"{pin!r} (or empty while the service is disabled)"
            )
    else:
        notes.append(
            f"overlay-literal: {overlay_name} does not set platformOrgId; "
            "the effective value is inherited from values.yaml and checked below"
        )

    # effective-values ---------------------------------------------------------
    merged = deep_merge(defaults, overlay)
    enabled = _lookup(merged, ENABLED_KEY, "effective production values")
    org = _lookup(merged, VALUES_KEY, "effective production values")
    if not isinstance(enabled, bool):
        raise GateError(
            f"effective selectionListService.enabled is {enabled!r} "
            f"({type(enabled).__name__}); it must be a boolean (the string \"false\" is truthy in Helm)"
        )
    if not isinstance(org, str):
        violations.append(
            f"[effective-values] effective selectionListService.platformOrgId is {org!r} "
            f"({type(org).__name__}); declare it as a string (\"\" when unset)"
        )
        org = None
    if org is not None:
        if org != "" and org != pin:
            violations.append(
                f"[effective-values] effective selectionListService.platformOrgId = {org!r} "
                f"{describe_mismatch(org, pin, pin_uuid)}; production may only be {pin!r}"
            )
        if enabled and org != pin:
            violations.append(
                "[effective-values] selectionListService.enabled=true in production but "
                f"platformOrgId is {org!r} ({describe_mismatch(org, pin, pin_uuid)}); an enabled "
                f"production service requires exactly {pin!r} (rule enabled-requires-pinned)"
            )
        if not enabled:
            if org == "":
                notes.append(
                    "RULE APPLIED disabled-empty-or-pinned: selectionListService.enabled=false "
                    "and platformOrgId is empty in production -> allowed (every platform feature "
                    "fails closed; the service is not deployed)"
                )
            elif org == pin:
                notes.append(
                    "RULE APPLIED disabled-empty-or-pinned: selectionListService.enabled=false "
                    "and platformOrgId is the pinned id -> allowed"
                )
        elif org == pin:
            notes.append(
                "RULE APPLIED enabled-requires-pinned: selectionListService.enabled=true and "
                "platformOrgId is the pinned id -> allowed"
            )

    # rendered (as deployed) ---------------------------------------------------
    docs, raw = helm_template(chart, overlay_path, helm, [])
    deployments = selection_list_deployments(docs)
    if enabled and len(deployments) != 1:
        violations.append(
            f"[rendered] effective enabled=true but the production render has "
            f"{len(deployments)} selection-list-service Deployment(s), expected 1"
        )
    if not enabled and deployments:
        violations.append(
            "[rendered] effective enabled=false but the production render contains a "
            "selection-list-service Deployment: the rendered chart disagrees with the values"
        )
    entries = check_render(docs, raw, "rendered", pin, pin_uuid, enabled, violations, notes)
    if enabled:
        per_dep = []
        for dep in deployments:
            found: list = []
            collect_env_entries(dep, found)
            per_dep.append(len(found))
        if any(n != 1 for n in per_dep):
            violations.append(
                f"[rendered] each selection-list-service Deployment must carry exactly one "
                f"{ENV_VAR} (found {per_dep})"
            )
    notes.append(
        f"rendered: production render has {len(deployments)} selection-list-service "
        f"Deployment(s) and {len(entries)} {ENV_VAR} occurrence(s)"
    )

    # rendered-forced (probe: what enablement would deploy) -----------------------
    fdocs, fraw = helm_template(
        chart, overlay_path, helm, ["--set", f"{SERVICE_BLOCK}.enabled=true"]
    )
    fdeps = selection_list_deployments(fdocs)
    if len(fdeps) != 1:
        violations.append(
            f"[rendered-forced] forcing the service on renders {len(fdeps)} "
            "selection-list-service Deployment(s), expected 1"
        )
    fentries = check_render(fdocs, fraw, "rendered-forced", pin, pin_uuid, False, violations, notes)
    if len(fdeps) == 1 and len(fentries) < 1:
        violations.append(
            f"[rendered-forced] the selection-list-service Deployment carries no {ENV_VAR}"
        )
    notes.append(
        f"rendered-forced: with the service forced on, {len(fentries)} {ENV_VAR} "
        f"occurrence(s) are '' or the pinned id"
    )

    return violations, notes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--chart", default="deploy/helm/fuzefront")
    ap.add_argument("--pin", default="governance/platform-org-pin.json")
    ap.add_argument("--overlay", default="values-prod.yaml", help="production overlay file name inside --chart")
    ap.add_argument("--helm", default="helm")
    args = ap.parse_args(argv)

    print("gate-platform-org-pin: production platform organization must be the pinned id")
    try:
        violations, notes = run_gate(Path(args.chart), Path(args.pin), args.overlay, args.helm)
    except GateError as e:
        print(f"::error title=gate-platform-org-pin::cannot evaluate (fail closed): {e}")
        print(f"FAIL (fail closed): {e}")
        return 1
    for n in notes:
        print(f"  {n}")
    if violations:
        for v in violations:
            print(f"::error title=gate-platform-org-pin::{v}")
            print(f"  VIOLATION {v}")
        print(f"FAIL: {len(violations)} violation(s)")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
