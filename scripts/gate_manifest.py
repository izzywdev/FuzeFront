#!/usr/bin/env python3
"""
gate-manifest — validate .fuze/manifest.json against the repo manifest schema.

WHY THIS EXISTS: nothing validated .fuze/manifest.json anywhere in the family. The
schema has been sitting in FuzeSDLC with `additionalProperties: false` while 19 of 22
real manifests violated it, and a typo in a CLOSED enum (fuzefinance's
channels: ["mcp","mobile"] — the token is "mobile-app") survived indefinitely because
the only reference to the schema in any executable file was a filename inside an error
string. A schema nothing runs is documentation, and documentation does not fail a PR.

WHERE THE SCHEMA COMES FROM. The gate looks, in order:
    .fuze/repo-manifest.schema.json          <- vendored per-repo by sdlc-bootstrap
    governance/repo-manifest.schema.json     <- FuzeSDLC itself, and any repo that has one
`.fuze/` is the vendoring target because it exists in all 21 repos and already holds the
file being validated. `agent-templates/schema/` was the obvious alternative — it is the
established vendored-schema location — but governance_sync gates that entire subtree on
`wants_roles`, and FIVE repos have no agent-templates/ at all (FuzeCall, FuzeFinance,
FuzeMarket, FuzeMerchandize, FuzeX). They would have silently never received it, which is
the exact failure this whole sweep is removing. Same two-location convention as
gate_identifier.py's allowlist lookup.

TWO MODES, AND IT ALWAYS SAYS WHICH. `jsonschema` is installed by exactly one workflow in
the family (provision.yml) and is guarded at its only import site, so a script that must
run anywhere cannot assume it. With the library: full validation. Without it: a structural
fallback covering required keys, closed-enum membership and unknown top-level properties —
genuinely weaker, and it prints so. A degraded run that looks identical to a clean one is
how every vacuous gate in this repo got that way.

Exit codes:  0 = clean   1 = violations   2 = usage/config error
(Gates exit; reconcilers report. See governance_sync.py for the other half of that rule.)

Usage:
    python scripts/gate_manifest.py [root]
    python scripts/gate_manifest.py . --schema path/to/schema.json
"""
import json
import os
import sys

SCHEMA_CANDIDATES = (
    os.path.join(".fuze", "repo-manifest.schema.json"),
    os.path.join("governance", "repo-manifest.schema.json"),
)
MANIFEST_REL = os.path.join(".fuze", "manifest.json")


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def find_schema(root, override=None):
    if override:
        p = override if os.path.isabs(override) else os.path.join(root, override)
        return p if os.path.isfile(p) else None
    for rel in SCHEMA_CANDIDATES:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            return p
    return None


def validate_full(manifest, schema):
    """Real validation. Returns (violations, True) or (None, False) if unavailable."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return None, False
    v = Draft202012Validator(schema)
    out = []
    for e in sorted(v.iter_errors(manifest), key=lambda e: list(e.path)):
        where = "/".join(str(x) for x in e.path) or "(root)"
        out.append(f"{where} — {e.message}")
    return out, True


def validate_structural(manifest, schema):
    """
    Fallback when jsonschema is absent. DELIBERATELY NOT a reimplementation of JSON Schema —
    three checks that catch the failures actually observed in this fleet, and nothing more.
    Claiming broader coverage than this delivers would be the same lie as a gate that skips.
    """
    out = []
    props = schema.get("properties", {})

    for key in schema.get("required", []):
        if key not in manifest:
            out.append(f"(root) — '{key}' is a required property")

    if schema.get("additionalProperties") is False:
        for key in manifest:
            if key not in props:
                out.append(f"(root) — additional property '{key}' is not allowed")

    # Closed enums, top level and one array level down. fuzefinance's invalid channel token
    # lived exactly here and went unnoticed for the life of the file.
    for key, spec in props.items():
        if key not in manifest:
            continue
        value = manifest[key]
        if "enum" in spec and value not in spec["enum"]:
            out.append(f"{key} — {value!r} is not one of {spec['enum']}")
        item_enum = (spec.get("items") or {}).get("enum") if spec.get("type") == "array" else None
        if item_enum and isinstance(value, list):
            for i, item in enumerate(value):
                if item not in item_enum:
                    out.append(f"{key}/{i} — {item!r} is not one of {item_enum}")
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = [a for a in argv[1:] if a.startswith("--")]

    override = None
    for i, a in enumerate(argv[1:]):
        if a == "--schema":
            override = argv[i + 2] if len(argv) > i + 2 else None

    known = {"--schema"}
    unknown = [f for f in flags if f not in known]
    if unknown:
        # Unknown flags exit 2 rather than passing silently — a mistyped flag that
        # "succeeds" is a gate that ran nothing. Same convention as gate_identifier.py.
        print(f"gate-manifest: unknown flag(s): {' '.join(unknown)}", file=sys.stderr)
        return 2

    root = args[0] if args else "."
    manifest_path = os.path.join(root, MANIFEST_REL)
    if not os.path.isfile(manifest_path):
        print(f"gate-manifest: no {MANIFEST_REL} — nothing to check.")
        return 0

    schema_path = find_schema(root, override)
    if not schema_path:
        # NOT a skip. Every repo that has this gate also has the schema, because
        # sdlc-bootstrap installs them together. Absence means the install is broken,
        # and reporting that as "nothing to do" is how a gate becomes decorative.
        print(
            "gate-manifest: ERROR — no repo-manifest.schema.json found in "
            f"{' or '.join(SCHEMA_CANDIDATES)}. It is vendored by sdlc-bootstrap "
            "alongside this gate; if you have the gate you must have the schema.",
            file=sys.stderr,
        )
        return 2

    try:
        manifest = _read_json(manifest_path)
    except (OSError, ValueError) as err:
        print(f"gate-manifest: {MANIFEST_REL} is not valid JSON: {err}", file=sys.stderr)
        return 1
    try:
        schema = _read_json(schema_path)
    except (OSError, ValueError) as err:
        print(f"gate-manifest: schema at {schema_path} is not readable: {err}", file=sys.stderr)
        return 2

    violations, full = validate_full(manifest, schema)
    if not full:
        violations = validate_structural(manifest, schema)

    mode = "full (jsonschema)" if full else "STRUCTURAL FALLBACK — jsonschema not installed"
    print(f"gate-manifest: schema={os.path.relpath(schema_path, root)} mode={mode}")
    if not full:
        print(
            "gate-manifest: NOTE — this run checked required keys, closed enums and unknown "
            "top-level properties only. Nested shapes, patterns and formats were NOT checked. "
            "Install jsonschema (pip install -q jsonschema) for full validation."
        )

    if violations:
        print(f"\ngate-manifest: {len(violations)} violation(s)\n")
        for v in violations:
            print(f"  ✗ {v}")
        print(
            "\nSee governance/repo-manifest.schema.json. Declare the typed block "
            "(mcp/mobile/a2a/...) rather than only naming it in `channels` — `channels` is "
            "deprecated and installs nothing."
        )
        return 1

    print("gate-manifest: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
