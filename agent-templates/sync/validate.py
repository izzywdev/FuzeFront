#!/usr/bin/env python3
"""Validate every role/environment/coordinator manifest against its JSON schema.

Also renders each agent payload (loading + frontmatter-stripping the persona) so
a missing persona file or broken merge fails here, before touching the API.
Exit non-zero on any failure. Requires `jsonschema` (see requirements.txt).
"""
import glob
import json
import os
import sys

import role_loader as rl

try:
    import jsonschema
except ImportError:
    sys.exit("jsonschema not installed — `pip install -r sync/requirements.txt`")

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_ROOT = os.path.dirname(HERE)
SCHEMA_DIR = os.path.join(TEMPLATES_ROOT, "schema")


def _schema(name):
    return json.load(open(os.path.join(SCHEMA_DIR, name), encoding="utf-8"))


def main():
    role_schema = _schema("role-manifest.schema.json")
    env_schema = _schema("environment.schema.json")
    errors = 0

    # Coordinators are optional (a framework-only repo may ship none) — glob rather
    # than hardcode a path, so validate.py runs cleanly wherever this template lands.
    coordinators = sorted(glob.glob(os.path.join(TEMPLATES_ROOT, "coordinator", "*.json")))
    for path in sorted(glob.glob(os.path.join(TEMPLATES_ROOT, "roles", "*", "role.json"))) + coordinators:
        # _base is a defaults fragment merged into other roles, not a full manifest.
        if os.path.basename(os.path.dirname(path)) == "_base":
            continue
        manifest = json.load(open(path, encoding="utf-8"))
        try:
            jsonschema.validate(manifest, role_schema)
            # exercise the full render (persona read + merge) for non-base roles
            if manifest.get("role") != "_base":
                merged = rl.load_manifest(path)
                payload = rl.agent_payload(merged)
                assert payload["system"], "empty system prompt"
            print(f"ok  {os.path.relpath(path, TEMPLATES_ROOT)}")
        except Exception as e:  # noqa: BLE001
            print(f"ERR {os.path.relpath(path, TEMPLATES_ROOT)}: {e}")
            errors += 1

    for path in sorted(glob.glob(os.path.join(TEMPLATES_ROOT, "environments", "*.json"))):
        manifest = json.load(open(path, encoding="utf-8"))
        try:
            jsonschema.validate(manifest, env_schema)
            print(f"ok  {os.path.relpath(path, TEMPLATES_ROOT)}")
        except Exception as e:  # noqa: BLE001
            print(f"ERR {os.path.relpath(path, TEMPLATES_ROOT)}: {e}")
            errors += 1

    if errors:
        sys.exit(f"\n{errors} manifest(s) failed validation")
    print("\nAll manifests valid.")


if __name__ == "__main__":
    main()
