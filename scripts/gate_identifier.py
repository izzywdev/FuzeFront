#!/usr/bin/env python3
"""gate-identifier — enforce the server-owned identifier standard.

Policy: governance/identifier-standard.md. The service that owns an entity mints
its identifier; clients never supply one. A client-chosen id turns a cross-type
UUID collision from ~0 probability into a certainty, and the collision enables
type confusion wherever a bare id is resolved without its type
(OWASP API3:2023 BOPLA).

Three check families:

  contracts (default)
    C1  a create request body must not declare an `id` for the resource created
    C2  a create request body schema must set `additionalProperties: false`
    C3  a polymorphic reference (`*EntityId` / `*OwnerId`) must carry a sibling
        type discriminator, so no lookup can resolve a bare id
    C4  a `lid`-able relationship must stay inside the service's own aggregate

  --source
    S1  uuid minting (`randomUUID`, `uuidv4`, `uuid.uuid4`) outside the sanctioned
        identity modules — every id must come from `mintId`/`mint_id`
    S2  `as EntityId<...>` casts, which forge the brand the type system relies on

  --registry-parity
    P1  packages/identity/src/registry.ts and
        packages/identity-py/fuzefront_identity/registry.py must agree exactly.
        A prefix that differs between them means a reference minted by a Node
        service is rejected by a Python one — a cross-language outage no
        single-language test can catch.

  --namespace
    N1  every prefix this repo mints is either its declared namespace's
        (`hub_ord`) or a spine prefix this repo owns. Parity (P1) is a
        WITHIN-repo check; nothing there stops two products both defining
        `ord`, which reintroduces the cross-type collision one level up.
    N2  the repo declares `identity.namespace` in .fuze/manifest.json

  --adoption
    A1  a repo that mints entity ids, or ships create operations, must depend
        on an identity package. The other families are all "is what is here
        correct" checks; a repo that adopts nothing passes every one of them
        vacuously. This is the absence check.

Exemptions: an operation may carry `x-client-assigned-id: allowed` (plus
`x-client-assigned-id-reason`), or the route may be listed in
governance/identifier-allowlist.txt as `METHOD /path`, one per line.

Usage: gate_identifier.py [root] [--source] [--registry-parity]
                                 [--namespace] [--adoption] [--all]
Exit 0 = pass (or no contracts found); exit 1 = violation.
Requires PyYAML for YAML specs; JSON specs need no extra deps.
"""
from __future__ import annotations

import json
import os
import re
import sys

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

SPEC_NAME_RE = re.compile(r"(openapi|swagger).*\.(ya?ml|json)$", re.I)
ALLOWLIST_PATHS = [
    "governance/identifier-allowlist.txt",
    ".fuze/identifier-allowlist.txt",
]

PRUNE_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "vendor", "__pycache__",
    "coverage", ".next", ".terraform", ".turbo", ".cache", "out", "target",
    "storybook-static", "playwright-report", "test-results",
}

# Where minting legitimately happens. Everything else must call mintId/mint_id.
IDENTITY_MODULES = (
    "packages/identity/src/",
    "packages/identity-py/fuzefront_identity/",
)

CREATE_METHODS = ("post", "put")
PATH_PARAM_TAIL_RE = re.compile(r"\{[^}]+\}/?$")

# Properties naming the resource being created. `organizationId`/`userId` and
# friends are REFERENCES to entities that already exist, so they are legitimate
# create-body fields and must not be flagged here.
SELF_ID_RE = re.compile(r"^(id|uuid|_id)$", re.I)

# A reference that can point at more than one entity type. These are the
# dangerous ones: without a sibling discriminator the id alone decides which
# table is consulted.
POLYMORPHIC_ID_RE = re.compile(r"^(entity|owner|subject|target|parent|resource)Id$", re.I)


# ---------------------------------------------------------------------------
# File discovery (shared conventions with scripts/gate_pagination.py)
# ---------------------------------------------------------------------------

def _candidate_files(root: str, patterns: list[str]) -> list[str]:
    """Tracked files only, via `git ls-files` — fast in a large monorepo — with a
    pruned os.walk fallback when git is unavailable."""
    import subprocess
    try:
        res = subprocess.run(
            ["git", "-C", root, "ls-files", "--", *patterns],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode == 0 and res.stdout.strip():
            files = [os.path.join(root, p) for p in res.stdout.splitlines() if p.strip()]
            return [
                f for f in files
                if not any(seg in PRUNE_DIRS for seg in f.replace("\\", "/").split("/"))
            ]
    except Exception:
        pass
    suffixes = tuple(p.lstrip("*") for p in patterns)
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
        for fn in filenames:
            if fn.endswith(suffixes):
                out.append(os.path.join(dirpath, fn))
    return out


def find_specs(root: str) -> list[str]:
    out = []
    for p in _candidate_files(root, ["*.yaml", "*.yml", "*.json", "**/*.yaml", "**/*.yml", "**/*.json"]):
        fn = os.path.basename(p)
        if SPEC_NAME_RE.search(fn) or fn in ("openapi.yaml", "openapi.yml", "openapi.json"):
            out.append(p)
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                head = f.read(400)
            if re.search(r'["\']?(openapi|swagger)["\']?\s*:', head):
                out.append(p)
        except OSError:
            pass
    return sorted(set(out))


def load_spec(path: str):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    if path.endswith(".json"):
        return json.loads(text)
    if yaml is None:
        return json.loads(text)
    return yaml.safe_load(text)


def load_allowlist(root: str) -> set[str]:
    allow = set()
    for rel in ALLOWLIST_PATHS:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.split("#", 1)[0].strip()
                    if line and not line.startswith("src "):
                        allow.add(line.lower())
    return allow


def load_source_allowlist(root: str) -> set[str]:
    """`src <path>:<line>` entries — sites the source backstop must not count.

    The backstop keys on the ASSIGNMENT TARGET (`id`, `<noun>Id`), which is all a
    grep-shaped check can see. That misreads `id: uuidv4()` inside
    `trx('event_outbox').insert({...})`: the row is an outbox record, not an
    entity, and it has no type to carry. Left uncounted, those inflate the
    backlog and make the number meaningless — and the backlog number is the only
    thing standing between the backstop and being ratcheted to enforcing.

    Every entry needs a reason in its comment. This exempts a site from being
    COUNTED, never from the standard: if the row is an entity, migrate it.
    """
    allow = set()
    for rel in ALLOWLIST_PATHS:
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            continue
        with open(p, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                if line.startswith("src "):
                    allow.add(line[4:].strip().replace("\\", "/"))
    return allow


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def resolve_ref(spec: dict, node, seen: set[str] | None = None):
    """Follow a local $ref to its schema. Returns the node unchanged otherwise."""
    seen = seen or set()
    for _ in range(20):
        if not isinstance(node, dict):
            return node
        ref = node.get("$ref")
        if not isinstance(ref, str) or not ref.startswith("#/"):
            return node
        if ref in seen:
            return {}
        seen.add(ref)
        target = spec
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            if not isinstance(target, dict) or part not in target:
                return {}
            target = target[part]
        node = target
    return node


def request_schemas(spec: dict, operation: dict):
    """Every JSON request-body schema of an operation, $refs resolved."""
    body = resolve_ref(spec, operation.get("requestBody"))
    if not isinstance(body, dict):
        return []
    content = body.get("content")
    if not isinstance(content, dict):
        return []
    out = []
    for media, entry in content.items():
        if "json" not in str(media).lower() or not isinstance(entry, dict):
            continue
        schema = resolve_ref(spec, entry.get("schema"))
        if isinstance(schema, dict):
            out.append(schema)
    return out


def composed_parts(spec: dict, schema: dict):
    """A schema plus everything it composes, so allOf branches are inspected too."""
    parts = [schema]
    for key in ("allOf", "oneOf", "anyOf"):
        for sub in schema.get(key, []) or []:
            resolved = resolve_ref(spec, sub)
            if isinstance(resolved, dict):
                parts.extend(composed_parts(spec, resolved))
    return parts


def is_create_operation(method: str, path: str, operation: dict) -> bool:
    """A create writes a NEW resource to a collection.

    Requires POSITIVE evidence of creation — a create verb in the operationId or
    summary, or a 201 response. Treating every bare POST as a create is wrong and
    noisy: `POST /auth/login`, `/authz/check`, `/mfa/verify` and `/chat/stream`
    are RPC-style actions that create no resource and have no id to own. A gate
    that cries wolf on those gets switched off, and then it protects nothing.

    `post`/`put` to a path ending in a parameter addresses an existing resource,
    so it is an update, not a create.
    """
    if method not in CREATE_METHODS:
        return False
    if PATH_PARAM_TAIL_RE.search(path):
        return False

    haystack = f"{operation.get('operationId', '')} {operation.get('summary', '')}".lower()
    if re.search(r"\b(create|add|register|provision|new|signup|sign-up|invite)", haystack):
        return True

    # 201 Created is the unambiguous machine-readable signal.
    return "201" in {str(code) for code in (operation.get("responses") or {})}


def is_exempt(operation: dict, method: str, path: str, allow: set[str]) -> bool:
    if str(operation.get("x-client-assigned-id", "")).lower() == "allowed":
        return True
    return f"{method.upper()} {path}".lower() in allow


# ---------------------------------------------------------------------------
# Contract checks
# ---------------------------------------------------------------------------

def check_contracts(root: str) -> list[str]:
    violations: list[str] = []
    allow = load_allowlist(root)
    specs = find_specs(root)

    for spec_path in specs:
        try:
            spec = load_spec(spec_path)
        except Exception as exc:
            print(f"  ! skipping unparseable spec {spec_path}: {exc}", file=sys.stderr)
            continue
        if not isinstance(spec, dict):
            continue
        rel = os.path.relpath(spec_path, root)
        paths = spec.get("paths")
        if not isinstance(paths, dict):
            continue

        for path, item in paths.items():
            if not isinstance(item, dict):
                continue
            for method, operation in item.items():
                method = str(method).lower()
                if method not in CREATE_METHODS or not isinstance(operation, dict):
                    continue
                if not is_create_operation(method, str(path), operation):
                    continue
                if is_exempt(operation, method, str(path), allow):
                    continue

                for schema in request_schemas(spec, operation):
                    label = f"{rel}: {method.upper()} {path}"

                    # C1 — no client-supplied id for the resource being created.
                    for part in composed_parts(spec, schema):
                        props = part.get("properties")
                        if not isinstance(props, dict):
                            continue
                        for prop in props:
                            if SELF_ID_RE.match(str(prop)):
                                violations.append(
                                    f"{label} — create body declares '{prop}'; the owning "
                                    f"service mints ids (identifier-standard.md 1)"
                                )

                    # C2 — reject unknown properties, so a stray id cannot bind.
                    if not any(
                        part.get("additionalProperties") is False
                        for part in composed_parts(spec, schema)
                    ):
                        violations.append(
                            f"{label} — create body schema does not set "
                            f"'additionalProperties: false' (identifier-standard.md 1)"
                        )

        # C3 — polymorphic references must carry their type, wherever they appear.
        schemas = (spec.get("components") or {}).get("schemas")
        if isinstance(schemas, dict):
            for name, schema in schemas.items():
                schema = resolve_ref(spec, schema)
                if not isinstance(schema, dict):
                    continue
                props = schema.get("properties")
                if not isinstance(props, dict):
                    continue
                for prop in props:
                    if not POLYMORPHIC_ID_RE.match(str(prop)):
                        continue
                    discriminator = re.sub(r"Id$", "Type", str(prop), flags=re.I)
                    if discriminator not in props:
                        violations.append(
                            f"{rel}: components.schemas.{name} — polymorphic reference "
                            f"'{prop}' has no sibling '{discriminator}'; a bare id must "
                            f"never decide which entity is resolved "
                            f"(identifier-standard.md 3)"
                        )

    if not specs:
        print("gate-identifier: no OpenAPI contracts found — nothing to check.")
    return violations


# ---------------------------------------------------------------------------
# Source backstop
# ---------------------------------------------------------------------------

# Only a uuid that becomes an ENTITY id matters here. Capture what the minted
# value is assigned to: `const appId = uuidv4()` or `id: randomUUID(),`.
MINT_RE = re.compile(
    r"""(?P<target>\b[A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*"""
    r"""(?:await\s+)?(?:randomUUID|uuidv4|uuid4|uuid\.uuid4)\s*\("""
)

# Ephemeral/infrastructure identifiers: correlation and tracing handles, OAuth
# nonces, one-shot tokens. They label a request or a message, not a stored
# entity, so they have no type to carry and are outside this standard.
NON_ENTITY_ID_RE = re.compile(
    r"^(request|correlation|trace|span|nonce|state|token|idempotency|event|"
    r"delivery|job|run|batch|transaction|tx|challenge|client|secret|key|salt|"
    r"verifier|code)",
    re.I,
)

# `id` alone, or `<noun>Id` — the shapes that name a persisted entity.
ENTITY_ID_TARGET_RE = re.compile(r"^(id|_id|[a-z][A-Za-z0-9]*Id)$")

BRAND_CAST_RE = re.compile(r"\bas\s+EntityId\s*<")


def check_source(root: str) -> list[str]:
    """Grep-shaped and therefore the BACKSTOP, not the mechanism.

    The real enforcement is the branded `EntityId<T>` type: a raw string off
    req.body does not compile against a repository that takes one. This catches
    the two ways to sidestep that.
    """
    violations: list[str] = []
    files = _candidate_files(root, ["*.ts", "*.py", "**/*.ts", "**/*.py"])
    exempt_sites = load_source_allowlist(root)
    used_exemptions: set[str] = set()

    for path in files:
        rel = os.path.relpath(path, root).replace("\\", "/")
        if any(rel.startswith(module) for module in IDENTITY_MODULES):
            continue
        # Tests and migrations legitimately fabricate ids and seed fixtures.
        if re.search(r"(^|/)(tests?|__tests__|migrations|scripts)/", f"/{rel}"):
            continue
        if rel.endswith((".test.ts", ".spec.ts", ".d.ts")):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except OSError:
            continue

        for number, line in enumerate(lines, 1):
            if line.lstrip().startswith(("//", "#", "*")):
                continue
            site = f"{rel}:{number}"
            if site in exempt_sites:
                # Only an actual mint site can consume its exemption; anything
                # left over at the end is stale and is reported below.
                if MINT_RE.search(line):
                    used_exemptions.add(site)
                continue
            match = MINT_RE.search(line)
            if match:
                target = match.group("target")
                if ENTITY_ID_TARGET_RE.match(target) and not NON_ENTITY_ID_RE.match(target):
                    violations.append(
                        f"{rel}:{number} — '{target}' is minted as a bare uuid; call "
                        f"mintId()/mint_id() so the id carries its type "
                        f"(identifier-standard.md 2)"
                    )
            if BRAND_CAST_RE.search(line):
                violations.append(
                    f"{rel}:{number} — casts to EntityId, forging the brand the type "
                    f"system relies on; use parseId()/parse_id() instead"
                )

    # A `src` entry whose line no longer mints anything has DRIFTED — the file
    # moved under it and it is now silently exempting whatever occupies that
    # line, which is an exemption nobody granted. Report rather than ignore.
    for stale in sorted(exempt_sites - used_exemptions):
        violations.append(
            f"identifier-allowlist — stale source exemption 'src {stale}': that line "
            f"no longer mints an id. Re-point it at the real site or delete it; a "
            f"drifting line number exempts code nobody reviewed"
        )
    return violations


# ---------------------------------------------------------------------------
# Cross-language registry parity
# ---------------------------------------------------------------------------

def check_registry_parity(root: str) -> list[str]:
    ts_path = os.path.join(root, "packages/identity/src/registry.ts")
    py_path = os.path.join(root, "packages/identity-py/fuzefront_identity/registry.py")
    if not (os.path.isfile(ts_path) and os.path.isfile(py_path)):
        return []

    with open(ts_path, encoding="utf-8") as f:
        ts_text = f.read()
    with open(py_path, encoding="utf-8") as f:
        py_text = f.read()

    ts_block = re.search(r"ENTITY_PREFIXES = \{(.*?)\n\} as const", ts_text, re.S)
    py_block = re.search(r"ENTITY_PREFIXES[^=]*=\s*MappingProxyType\(\s*\{(.*?)\n\s*\}\s*\)", py_text, re.S)
    if not ts_block or not py_block:
        return ["registry parity — could not locate ENTITY_PREFIXES in one of the registries"]

    ts_pairs = dict(re.findall(r"^\s*(\w+):\s*'([a-z_]+)',", ts_block.group(1), re.M))
    py_pairs = dict(re.findall(r'^\s*"(\w+)":\s*"([a-z_]+)",', py_block.group(1), re.M))

    if ts_pairs == py_pairs:
        return []

    violations = []
    for key in sorted(set(ts_pairs) | set(py_pairs)):
        ts_value, py_value = ts_pairs.get(key), py_pairs.get(key)
        if ts_value != py_value:
            violations.append(
                f"registry parity — '{key}': registry.ts={ts_value!r} but "
                f"registry.py={py_value!r}; a reference minted by one language "
                f"would be rejected by the other"
            )
    return violations


# ---------------------------------------------------------------------------
# Namespacing (baseline v1.5.0)
# ---------------------------------------------------------------------------

# The RESERVED SPINE PREFIXES, and the repo that owns each. Deliberately a
# constant in this script rather than a per-repo config file: every repo runs
# the same gate, so extending the list is an edit to a governance-managed script
# that shows up in review, not a line a repo can quietly add to its own manifest.
#
# Spine types stay BARE on purpose. A FuzeHub service holding a user id is
# holding *FuzeFront's* id — `front_usr_` would misrepresent who owns it. So the
# shared surface is a short reserved-word list instead of a growing registry
# every product has to PR into.
#
# It is short and it is closed. Everything else namespaces (`hub_ord_`), needs
# no coordination at all, and is self-allocating because repo names are already
# unique within the org.
SPINE_PREFIXES = {
    # identity / platform spine
    "usr": "FuzeFront",
    "org": "FuzeFront",
    "prt": "FuzeFront",
    "app": "FuzeFront",
    # billing — FuzeFront hosts billing-service for the whole family, so a
    # family invoice is `inv_`. A product's own quote-invoice is `sales_inv_`.
    "cus": "FuzeFront",
    "sub": "FuzeFront",
    "pay": "FuzeFront",
    "inv": "FuzeFront",
    "crd": "FuzeFront",
    # identity, continued — see registry.ts
    "ivt": "FuzeFront",
    "mbr": "FuzeFront",
    "ses": "FuzeFront",
    "mfa": "FuzeFront",
    # messaging — likewise hosted here for the family
    "cnv": "FuzeFront",
    "msg": "FuzeFront",
    "ntf": "FuzeFront",
}

TS_PREFIX_RE = re.compile(r"^\s*(\w+):\s*'([a-z][a-z_]*)',", re.M)
PY_PREFIX_RE = re.compile(r'^\s*"(\w+)":\s*"([a-z][a-z_]*)",', re.M)


def load_manifest(root: str) -> dict:
    path = os.path.join(root, ".fuze/manifest.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def repo_short_name(manifest: dict) -> str:
    """`izzywdev/FuzeFront` -> `FuzeFront`."""
    return str(manifest.get("repo", "")).split("/")[-1]


def find_registries(root: str) -> dict[str, dict[str, str]]:
    """Every `ENTITY_PREFIXES` declaration in the repo, as {file: {type: prefix}}.

    Not hardcoded to the two reference paths: a consuming repo declares its own
    product types in its own module, and the namespacing rule has to reach those
    — they are precisely the ones that can collide with another product's.
    """
    found: dict[str, dict[str, str]] = {}
    for path in _candidate_files(root, ["*.ts", "*.py", "**/*.ts", "**/*.py"]):
        rel = os.path.relpath(path, root).replace("\\", "/")
        if rel.endswith((".test.ts", ".spec.ts", ".d.ts")) or "/tests/" in f"/{rel}":
            continue
        if rel == "scripts/gate_identifier.py":
            continue
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        if "ENTITY_PREFIXES" not in text:
            continue
        block = re.search(r"ENTITY_PREFIXES[^{]*\{(.*?)\n\s*\}", text, re.S)
        if not block:
            continue
        pairs = dict(TS_PREFIX_RE.findall(block.group(1))) or dict(
            PY_PREFIX_RE.findall(block.group(1))
        )
        if pairs:
            found[rel] = pairs
    return found


def check_namespace(root: str) -> list[str]:
    """Family-wide prefix uniqueness, checked ENTIRELY LOCALLY.

    `--registry-parity` compares TypeScript to Python *inside one repo*. Nothing
    there compares one repo to another, so FuzeHub and FuzeSales could each
    define `ord` and both pass — reintroducing at the family level the exact
    cross-type collision the standard exists to prevent.

    The fix is not a central registry (a coordination bottleneck on something as
    routine as adding a table). It is a namespace per product, and because repo
    names are already unique within the org, that namespace is self-allocating.
    This check therefore never fetches, never syncs, and cannot be wrong about
    another repo because it never looks at one.
    """
    registries = find_registries(root)
    if not registries:
        return []

    manifest = load_manifest(root)
    identity = manifest.get("identity") if isinstance(manifest.get("identity"), dict) else {}
    namespace = str(identity.get("namespace", "")).strip()
    repo = repo_short_name(manifest)

    # N2 — the namespace is DECLARED, never derived from the directory name. A
    # repo rename would otherwise silently orphan every id already issued, and
    # that failure surfaces much later as unresolvable references with no
    # obvious cause.
    if not namespace:
        return [
            f"namespace — .fuze/manifest.json declares no 'identity.namespace', but "
            f"{', '.join(sorted(registries))} mints entity prefixes; declare it "
            f"explicitly (identifier-standard.md 2)"
        ]
    if not re.fullmatch(r"[a-z][a-z0-9]*", namespace):
        return [
            f"namespace — 'identity.namespace' is {namespace!r}; must match "
            f"^[a-z][a-z0-9]*$ so `<namespace>_<type>` stays a valid TypeID prefix"
        ]

    violations: list[str] = []
    for rel, pairs in sorted(registries.items()):
        for entity_type, prefix in sorted(pairs.items()):
            owner = SPINE_PREFIXES.get(prefix)
            if owner is not None:
                # N1a — a spine prefix, minted by the repo that owns it.
                if repo and owner.lower() != repo.lower():
                    violations.append(
                        f"{rel}: '{entity_type}' mints reserved spine prefix "
                        f"{prefix!r}, which is owned by {owner}; namespace it as "
                        f"'{namespace}_{prefix}' (identifier-standard.md 2)"
                    )
                continue
            # N1b — everything else must carry this product's namespace.
            if not prefix.startswith(f"{namespace}_"):
                violations.append(
                    f"{rel}: '{entity_type}' mints bare prefix {prefix!r}; a "
                    f"product-local type must be namespaced "
                    f"('{namespace}_{prefix}') or be a reserved spine prefix, "
                    f"or two products can both define it "
                    f"(identifier-standard.md 2)"
                )
    return violations


# ---------------------------------------------------------------------------
# Adoption — the absence check
# ---------------------------------------------------------------------------

IDENTITY_PACKAGE_RE = re.compile(r"fuzefront[-_]identity|@fuzefront/identity")


def _declares_identity_dependency(root: str) -> bool:
    """Node manifest, Python manifest, or being the reference repo itself."""
    if os.path.isdir(os.path.join(root, "packages/identity")):
        return True
    manifests = _candidate_files(
        root,
        ["package.json", "**/package.json", "pyproject.toml", "**/pyproject.toml",
         "requirements*.txt", "**/requirements*.txt"],
    )
    for path in manifests:
        rel = os.path.relpath(path, root).replace("\\", "/")
        if "node_modules/" in rel:
            continue
        try:
            with open(path, encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        if rel.endswith("package.json"):
            try:
                data = json.loads(text)
            except Exception:
                continue
            for section in ("dependencies", "devDependencies", "peerDependencies"):
                for name in (data.get(section) or {}):
                    if IDENTITY_PACKAGE_RE.search(str(name)):
                        return True
        elif IDENTITY_PACKAGE_RE.search(text):
            return True
    return False


def _has_entity_work(root: str) -> tuple[int, int]:
    """(mint sites, create operations) — the evidence this repo owns entities."""
    mint_sites = sum(
        1
        for violation in check_source(root)
        if "minted as a bare uuid" in violation
    )

    creates = 0
    for spec_path in find_specs(root):
        try:
            spec = load_spec(spec_path)
        except Exception:
            continue
        if not isinstance(spec, dict):
            continue
        for path, item in (spec.get("paths") or {}).items():
            if not isinstance(item, dict):
                continue
            for method, operation in item.items():
                if isinstance(operation, dict) and is_create_operation(
                    str(method).lower(), str(path), operation
                ):
                    creates += 1
    return mint_sites, creates


def check_adoption(root: str) -> list[str]:
    """Does this repo actually HAVE the standard, or merely not violate it?

    Every other family here asks "is what is present correct". A repo that
    adopted nothing at all passes all of them: no contracts means "nothing to
    check", and the source backstop is report-only. Green, and completely
    unprotected. Only an absence check catches that, and a family standard whose
    gate is satisfied by non-adoption is not a standard.
    """
    if _declares_identity_dependency(root):
        return []
    mint_sites, creates = _has_entity_work(root)
    if not mint_sites and not creates:
        return []
    evidence = []
    if mint_sites:
        evidence.append(f"{mint_sites} entity-id mint site(s)")
    if creates:
        evidence.append(f"{creates} create operation(s)")
    return [
        f"adoption — this repo has {' and '.join(evidence)} but declares no "
        f"dependency on an identity package (@izzywdev/fuzefront-identity or "
        f"fuzefront-identity); the standard cannot be enforced by a package the "
        f"repo does not have (identifier-standard.md 9)"
    ]


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("-")]
    flags = {a for a in argv[1:] if a.startswith("-")}
    root = args[0] if args else "."
    run_all = "--all" in flags

    known = {"--all", "--source", "--registry-parity", "--namespace", "--adoption"}
    unknown = flags - known
    if unknown:
        print(f"gate-identifier: unknown flag(s) {' '.join(sorted(unknown))}", file=sys.stderr)
        return 2

    violations: list[str] = []
    if run_all or not (flags - {"--all"}):
        violations += check_contracts(root)
    if run_all or "--source" in flags:
        violations += check_source(root)
    if run_all or "--registry-parity" in flags:
        violations += check_registry_parity(root)
    if run_all or "--namespace" in flags:
        violations += check_namespace(root)
    if run_all or "--adoption" in flags:
        violations += check_adoption(root)

    if violations:
        print(f"\ngate-identifier: {len(violations)} violation(s)\n")
        for violation in violations:
            print(f"  ✗ {violation}")
        print("\nSee governance/identifier-standard.md. To exempt an operation, add")
        print("`x-client-assigned-id: allowed` with a reason, or list the route in")
        print("governance/identifier-allowlist.txt.")
        return 1

    print("gate-identifier: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
