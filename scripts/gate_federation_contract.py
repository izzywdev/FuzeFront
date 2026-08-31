#!/usr/bin/env python3
"""gate-federation-contract — the four-layer Module-Federation serve contract.

governance/naming-and-addressing.md, "What must actually agree", has said this for
months:

    registration/manifest.json   integration.remoteEntry
    vite / webpack               base
    the chart's ingress          path
    the web server               location / alias, and where the Dockerfile puts the build

    A mismatch at any layer returns HTTP 200 on `remoteEntry.js` and then 404s every
    chunk -- a blank panel behind a green healthcheck. The fourth layer is the one
    most often missed: an ingress can route the prefix correctly to a container whose
    nginx has no matching `location`, and whose Dockerfile copied the build flat.

FuzeService then shipped exactly that -- a Dockerfile copying the MFE build flat to
`/usr/share/nginx/html` with no `/apps/service/` layout -- because the rule existed and
the enforcement did not. Nothing in the fleet matched `federat|remote|serve|mfe`; there
was no gate-federation anywhere. This is that gate.

WHAT IS ASSERTED, AND WHAT IS EMPHATICALLY NOT
==============================================
The four layers must agree with EACH OTHER. They are NOT required to agree with the
`slug`.

`frontend/src/utils/loadFederatedApp.ts:71` is the entire path-resolution mechanism:

    const resolved = new URL(remoteEntry, origin)

The host resolves `integration.remoteEntry` against its own origin and loads it. The
slug is not an input. No code derives a serve path from a slug and none derives a slug
from a path. This has been re-litigated four times in this fleet, each round mutating
live manifests, so it is written into the gate itself: if the four agree on
`/apps/anything/`, that passes. This gate NEVER emits a finding saying a path should
match a slug, and NEVER suggests editing a slug -- a slug is immutable, and editing one
registers a second app and strands the first (orphaned Permit grants, CASCADE-deleted
`app_installations` rows, a ghost tile in the launcher).

APPLICABILITY IS DECLARED, NEVER INFERRED
=========================================
Whether a repo has this contract at all is read from `registration/manifest.json`'s
`integration.type`, and from nothing else:

    module-federation / mf-remote  -> APPLICABLE, every layer is checked
    iframe / spa / anything else   -> SKIPPED, and the declared type is printed
    no registration/manifest.json  -> SKIPPED (this repo registers no portal app;
                                      whether it should is gate-registration's question)
    integration.type absent        -> FINDING, not a skip

A MISSING FILE IS NEVER A REASON TO PASS. A repo that declares `module-federation` and
has no vite config, no chart Ingress, no nginx conf or no Dockerfile gets a finding for
the layer it cannot produce. That distinction is the entire difference between this gate
and the vacuous ones this fleet spent a sweep deleting: `.gitleaks.toml` with no rules,
`gate-authz` ending in `|| true`, `gate-identifier`'s never-set opt-in flag, an
`a2a-maintain` that skipped when unkeyed. Each was green because it had nothing to say,
and each was read as evidence.

LAYER TOKENS (stable; the self-tests assert on them)
====================================================
    [L1 manifest]      integration.remoteEntry, and its vendored Helm copy
    [L2 build-base]    vite/webpack `base` (+ `assetsDir`, + federation `filename`)
    [L3 ingress]       the chart's federated-mount Ingress `path`
    [L4a webserver]    the nginx `location` / `alias` -- either dialect
    [L4b image-layout] where the Dockerfile actually COPYs the build

Layer 4 has TWO halves and a check that reads only the nginx conf passes FuzeService:
its `location / { root /usr/share/nginx/html; }` resolves `/apps/service/remoteEntry.js`
to exactly the right filesystem path. The defect is that nothing ever put a file there.

Usage:
    gate_federation_contract.py [root] [--json] [--repo owner/name] [--policy PATH]
Exit 0 = pass or skipped; exit 1 = violation.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
from urllib.parse import urlparse

# --------------------------------------------------------------------------------------
# Layers
# --------------------------------------------------------------------------------------

L1 = "L1 manifest"
L2 = "L2 build-base"
L3 = "L3 ingress"
L4A = "L4a webserver"
L4B = "L4b image-layout"

ALL_LAYERS = (L1, L2, L3, L4A, L4B)

#: Types that HAVE this contract. Anything else is a declared skip.
MF_TYPES = {"module-federation", "module_federation", "mf-remote", "mf_remote"}

SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", "out", ".next", "coverage",
    "__pycache__", ".venv", "venv", "vendor", ".turbo", ".cache",
}

DEFAULT_DOCROOT = "/usr/share/nginx/html"
DEFAULT_ASSETS_DIR = "assets"
DEFAULT_REMOTE_FILENAME = "remoteEntry.js"


class Finding:
    def __init__(self, layer: str, message: str) -> None:
        self.layer = layer
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"[{self.layer}] {self.message}"


# --------------------------------------------------------------------------------------
# Filesystem walk
# --------------------------------------------------------------------------------------

def walk_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            yield os.path.relpath(full, root).replace(os.sep, "/"), full


def read_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def read_bytes(path: str) -> bytes:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return b""


# --------------------------------------------------------------------------------------
# Path helpers
# --------------------------------------------------------------------------------------

def as_dir(p: str) -> str:
    """`/apps/x` and `/apps/x/` both normalise to `/apps/x/`. `` -> `/`."""
    if not p:
        return "/"
    if not p.startswith("/"):
        p = "/" + p
    return p if p.endswith("/") else p + "/"


def norm_fs_dir(p: str) -> str:
    """Filesystem directory, trailing slash stripped, `.`/`..` collapsed."""
    if not p:
        return ""
    p = posixpath.normpath(p.strip().strip('"').strip("'"))
    return p.rstrip("/") or "/"


def join_url(*parts: str) -> str:
    out = ""
    for part in parts:
        if not part:
            continue
        if not out:
            out = part
        else:
            out = out.rstrip("/") + "/" + part.lstrip("/")
    return out if out.startswith("/") else "/" + out


# --------------------------------------------------------------------------------------
# Layer 1 -- registration/manifest.json (+ vendored Helm copy)
# --------------------------------------------------------------------------------------

PRIMARY_REL = "registration/manifest.json"

#: Where THIS repo's own Helm charts live, anchored at the repo root.
#:
#: ANCHORED IS THE WHOLE POINT. A co-vendored foreign product carries its own chart, so
#: an unanchored "is there a Chart.yaml above this file?" test happily swallows
#: `FuzeQuality/helm/fuzequality/files/registration/manifest.json` inside FuzeFront and
#: diffs another product's identity against this one's. Anchoring at the repo root
#: excludes it structurally: a vendored tree begins with `<Product>/`, which matches
#: none of these prefixes.
CHART_PARENTS = ("helm", "deploy/helm", "charts", "deploy/charts")


def own_chart_dirs(root: str):
    """This repo's own chart roots: `<anchored parent>/<name>/` holding a Chart.yaml.

    Chart.yaml is required as evidence, so a directory merely NAMED helm/ does not
    confer chart status on whatever happens to sit beneath it.
    """
    out = []
    for parent in CHART_PARENTS:
        pdir = os.path.join(root, parent)
        if not os.path.isdir(pdir):
            continue
        for name in sorted(os.listdir(pdir)):
            cdir = os.path.join(pdir, name)
            if os.path.isfile(os.path.join(cdir, "Chart.yaml")):
                out.append(f"{parent}/{name}/")
    return out


def find_registration_manifests(root: str):
    """(primary_rel or None, [vendored_rel...]).

    The primary is ONLY the repo-root `registration/manifest.json`. It is not "the
    shallowest one found": FuzeFront vendors an entire `FuzeQuality/` tree, so a
    shallowest-wins search reads another product's manifest and reports FuzeFront -- the
    HOST, which registers no portal app of its own -- as a broken remote.

    OWNERSHIP IS POSITIONAL, NOT BY SLUG, AND THAT CORRECTION IS THE POINT.
    ----------------------------------------------------------------------
    This function used to admit a copy only if its `slug` matched the root's. That made
    slug equality do two jobs at once -- IDENTIFYING the copy and VALIDATING it -- so a
    failure of the second silently disabled the first. A copy whose slug had gone stale
    read as "a different product" and was skipped, which turned the check off exactly
    when it had something to say.

    Measured on FuzeAgent (live main 0f38ee1):

        registration/manifest.json                        slug "fuzeagent"
        deploy/helm/fuzeagent/files/registration/…json    slug "agent"
                                                          + the old cross-origin
                                                          https://fuzeagent.prod…/remoteEntry.js

    `diff` showed both fields differing; the gate reported nothing. And a stale SLUG is
    worse than a stale path: the init container POSTs that copy, so it registers a
    SECOND, WRONG app against FuzeFront's seed rather than merely serving a broken one.

    So the two jobs are separated:

      identify   positionally -- a registration manifest under one of THIS repo's own
                 anchored chart roots is this product's vendored copy, whatever slug it
                 contains.
      validate   afterwards, in check_manifest, where a differing slug is a FINDING.

    Slug equality survives only as an ADDITIONAL inclusion rule, never an exclusion one:
    a copy outside any chart directory that still declares this repo's slug is obviously
    this product's and is picked up too. The two rules union; neither can now suppress
    the other.
    """
    if not os.path.isfile(os.path.join(root, PRIMARY_REL)):
        return None, []
    try:
        with open(os.path.join(root, PRIMARY_REL), encoding="utf-8") as f:
            slug = json.load(f).get("slug")
    except (OSError, ValueError):
        slug = None

    charts = own_chart_dirs(root)
    vendored = []
    for rel, full in walk_files(root):
        if rel == PRIMARY_REL or not rel.endswith("/" + PRIMARY_REL):
            continue
        if any(rel.startswith(c) for c in charts):
            vendored.append(rel)          # positional: this repo's own chart
            continue
        try:
            with open(full, encoding="utf-8") as f:
                other_slug = json.load(f).get("slug")
        except (OSError, ValueError):
            other_slug = None
        if slug is not None and other_slug == slug:
            vendored.append(rel)          # union rule: same product, unusual location
    return PRIMARY_REL, sorted(vendored)


def check_manifest(root: str, primary_rel: str, vendored: list, findings: list):
    """Returns (manifest_dict, entry_path or None)."""
    raw = read_bytes(os.path.join(root, primary_rel))
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        findings.append(Finding(L1, f"{primary_rel} does not parse as JSON: {exc}"))
        return {}, None

    # The vendored Helm copy is what the cluster actually serves. A divergence between
    # the two is itself the bug: the repo says one address, the deployment publishes
    # another, and nothing reconciles them.
    for rel in vendored:
        other_raw = read_bytes(os.path.join(root, rel))
        try:
            other = json.loads(other_raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            findings.append(Finding(L1, f"vendored copy {rel} does not parse as JSON: {exc}"))
            continue
        if other != manifest:
            # THE SLUG IS CALLED OUT SEPARATELY AND FIRST, because it is a different and
            # worse failure than a drifted path. The init container POSTs this copy, so a
            # stale slug registers a SECOND, WRONG app against FuzeFront's seed instead of
            # merely serving a broken one -- and it is the case the old slug-scoped search
            # could not see, because a differing slug made the copy invisible to it.
            got, want = other.get("slug"), manifest.get("slug")
            if got != want:
                findings.append(Finding(
                    L1,
                    f"vendored copy {rel} declares slug {got!r} while {primary_rel} "
                    f"declares {want!r}. The init container POSTs the VENDORED copy, so "
                    f"this registers a second, wrong app rather than the one this repo "
                    f"owns. The two files are one artifact and must be byte-identical: "
                    f"fix {rel} to match {primary_rel}. Fix the VENDORED COPY, never the "
                    f"root -- a slug is immutable once registered, and changing the "
                    f"authoritative one strands the live registration (orphaned Permit "
                    f"grants, CASCADE-deleted app_installations rows, a ghost tile)."))
            a = json.dumps(manifest.get("integration", {}), sort_keys=True)
            b = json.dumps(other.get("integration", {}), sort_keys=True)
            if a != b:
                findings.append(Finding(
                    L1,
                    f"vendored copy {rel} DIFFERS from {primary_rel}. The chart copy is "
                    f"what the cluster serves, so the two are one artifact and must be "
                    f"kept byte-identical. integration in {primary_rel}: {a}; in {rel}: "
                    f"{b}"))
            elif got == want:
                findings.append(Finding(
                    L1,
                    f"vendored copy {rel} DIFFERS from {primary_rel} outside the "
                    f"`integration` block and the slug. They are one artifact and must be "
                    f"byte-identical -- fix the vendored copy."))
        elif other_raw != raw:
            findings.append(Finding(
                L1,
                f"vendored copy {rel} is semantically equal to {primary_rel} but not "
                f"byte-identical (formatting/whitespace). Keep them byte-identical so a "
                f"diff of the pair is always empty and a real divergence is visible."))

    integration = manifest.get("integration")
    if not isinstance(integration, dict):
        findings.append(Finding(
            L1,
            f"{primary_rel} has no `integration` object, so this repo does not DECLARE "
            f"whether it is a Module-Federation remote. Applicability is declared, never "
            f"inferred -- an absent declaration is a defect, not a skip."))
        return manifest, None

    entry = integration.get("remoteEntry")
    if not isinstance(entry, str) or not entry.strip():
        findings.append(Finding(
            L1,
            f"{primary_rel} declares integration.type "
            f"'{integration.get('type')}' but no `integration.remoteEntry`. That URL is "
            f"the address the host resolves against its own origin "
            f"(loadFederatedApp.ts: `new URL(remoteEntry, origin)`); without it there is "
            f"nothing to load and nothing for the other three layers to agree with."))
        return manifest, None

    path = urlparse(entry.strip()).path
    if not path or not path.startswith("/"):
        findings.append(Finding(
            L1, f"{primary_rel} integration.remoteEntry '{entry}' has no absolute URL path"))
        return manifest, None
    return manifest, path


# --------------------------------------------------------------------------------------
# Layer 2 -- the bundler config
# --------------------------------------------------------------------------------------

BUILD_CONFIG_RE = re.compile(r"^(vite|webpack|rspack|rollup)\.config\.(js|ts|mjs|cjs|mts|cts)$")

_BASE_RE = re.compile(r"""(?<![\w.])base\s*:\s*(['"])(?P<v>[^'"]*)\1""")
_ASSETS_DIR_RE = re.compile(r"""(?<![\w.])assetsDir\s*:\s*(['"])(?P<v>[^'"]*)\1""")
_OUT_DIR_RE = re.compile(r"""(?<![\w.])outDir\s*:\s*(['"])(?P<v>[^'"]*)\1""")
_FILENAME_RE = re.compile(r"""(?<![\w.])filename\s*:\s*(['"])(?P<v>[^'"]+)\1""")
_FED_NAME_RE = re.compile(r"""(?<![\w.])name\s*:\s*(['"])(?P<v>[^'"]+)\1""")


class BuildConfig:
    def __init__(self, rel: str, text: str) -> None:
        self.rel = rel
        self.text = text
        m = _BASE_RE.search(text)
        # Vite's default. A remote built with no `base` requests its chunks from `/`,
        # which is a real configuration and not a missing one.
        self.base = as_dir(m.group("v")) if m else "/"
        self.base_declared = m is not None
        m = _ASSETS_DIR_RE.search(text)
        self.assets_dir = m.group("v") if m else DEFAULT_ASSETS_DIR
        m = _OUT_DIR_RE.search(text)
        self.out_dir = m.group("v") if m else "dist"
        fed_at = text.find("federation(")
        tail = text[fed_at:] if fed_at >= 0 else text
        m = _FILENAME_RE.search(tail)
        self.filename = m.group("v") if m else DEFAULT_REMOTE_FILENAME
        m = _FED_NAME_RE.search(tail)
        self.scope = m.group("v") if m else ""

    @property
    def entry_path(self) -> str:
        """Where this config actually publishes remoteEntry.js.

        `base` + `assetsDir` + `filename`. The assetsDir term is why the family
        convention is `assetsDir: ''`: leave it at Vite's default and the entry lands at
        `<base>assets/remoteEntry.js`, one segment deeper than most manifests claim.
        Two repos in the fleet (fuzesales, fuzecontact) legitimately use the default and
        declare `/assets/remoteEntry.js`, which is why this is computed rather than
        assumed away.
        """
        return join_url(self.base, self.assets_dir, self.filename)


def find_build_configs(root: str):
    out = []
    for rel, full in walk_files(root):
        if not BUILD_CONFIG_RE.match(os.path.basename(rel)):
            continue
        text = read_text(full)
        if "federation" not in text:
            continue
        out.append(BuildConfig(rel, text))
    return out


def pick_build_config(configs, manifest, entry_path):
    """Which config publishes THIS manifest's remote, when a repo holds several.

    Preference order, most specific first: the federation `name` equals the manifest's
    `integration.scope`; the computed entry path already equals the declared one; else
    the shallowest path. Guessing wrong in a multi-remote repo would report a mismatch
    against a config that was never meant to serve this entry.
    """
    if not configs:
        return None
    scope = (manifest.get("integration") or {}).get("scope")
    if scope:
        for c in configs:
            if c.scope == scope:
                return c
    if entry_path:
        for c in configs:
            if c.entry_path == entry_path:
                return c
    return sorted(configs, key=lambda c: (c.rel.count("/"), c.rel))[0]


def check_build_config(cfg, configs, entry_path, findings):
    """Returns serve_root (the URL prefix the built app requests its chunks from)."""
    if cfg is None:
        findings.append(Finding(
            L2,
            "registration/manifest.json declares a Module-Federation remote, but no "
            "bundler config containing a `federation` plugin was found (looked for "
            "vite/webpack/rspack/rollup.config.*). A missing build config is a finding, "
            "not a reason to pass: without one, nothing in this repo actually builds the "
            "remote the manifest advertises."))
        return None

    if entry_path is None:
        return cfg.base

    if cfg.entry_path != entry_path:
        detail = (f"base={cfg.base!r} assetsDir={cfg.assets_dir!r} "
                  f"filename={cfg.filename!r} -> {cfg.entry_path}")
        extra = ""
        if len(configs) > 1:
            extra = (f" ({len(configs)} federation configs in this repo; matched "
                     f"{cfg.rel} by "
                     f"{'integration.scope' if cfg.scope else 'path depth'})")
        findings.append(Finding(
            L2,
            f"{cfg.rel} publishes remoteEntry at {cfg.entry_path}, but "
            f"registration/manifest.json advertises {entry_path}. {detail}{extra}. "
            f"These are one contract: the host fetches the advertised URL and then loads "
            f"every chunk relative to `base`, so a disagreement here is HTTP 200 on "
            f"remoteEntry.js followed by 404 on everything it imports. Fix whichever side "
            f"is wrong -- never by editing the slug, which is not an input to either."))
    return cfg.base


# --------------------------------------------------------------------------------------
# Layer 3 -- the chart's Ingress
# --------------------------------------------------------------------------------------

_INGRESS_PATH_RE = re.compile(r"^\s*-?\s*path:\s*(?P<v>\S.*?)\s*$", re.M)
_HELM_DEFAULT_RE = re.compile(r"""default\s+(['"])(?P<v>/[^'"]*)\1""")


def find_ingress_texts(root: str):
    out = []
    for rel, full in walk_files(root):
        if not rel.endswith((".yaml", ".yml")):
            continue
        text = read_text(full)
        if "kind: Ingress" not in text:
            continue
        out.append((rel, text))
    return out


def ingress_paths(text: str):
    """(literal_paths, unresolved_raw_values)."""
    literal, unresolved = [], []
    for m in _INGRESS_PATH_RE.finditer(text):
        raw = m.group("v").strip().strip('"').strip("'")
        if raw.startswith("/"):
            literal.append(raw)
        elif "{{" in raw:
            # A Helm expression. `{{ .path | default "/" }}` still carries a literal
            # fallback, and that fallback is what the chart ships when values are silent.
            d = _HELM_DEFAULT_RE.search(raw)
            if d:
                literal.append(d.group("v"))
            else:
                unresolved.append(raw)
        elif raw:
            unresolved.append(raw)
    return literal, unresolved


def check_ingress(root, entry_path, serve_root, findings):
    texts = find_ingress_texts(root)
    if not texts:
        findings.append(Finding(
            L3,
            "no Ingress found in this repo's chart(s). A Module-Federation remote has to "
            "be reachable at its advertised path from outside the cluster; with no "
            "Ingress there is nothing routing it, and nothing for the other three layers "
            "to agree with. A missing chart is a finding, not a skip."))
        return

    target = entry_path or serve_root or "/"
    literal_all, unresolved_all = [], []
    for rel, text in texts:
        lit, unres = ingress_paths(text)
        literal_all += [(rel, p) for p in lit]
        unresolved_all += [(rel, p) for p in unres]

    for rel, p in literal_all:
        # pathType: Prefix. `/` routes everything, which is how most of the fleet's
        # frontends are wired and is correct -- the requirement is that the advertised
        # path is ROUTED, not that the Ingress repeats it.
        if target.startswith(p if p.endswith("/") else p + "/") or target == p or p == "/":
            return

    if literal_all:
        shown = ", ".join(f"{rel}:{p}" for rel, p in literal_all)
        findings.append(Finding(
            L3,
            f"no Ingress path routes {target}. Declared paths: {shown}. The Ingress must "
            f"prefix-match the advertised remoteEntry URL or the request never reaches "
            f"the container -- the panel is blank while every in-cluster probe is green."))
        return

    shown = ", ".join(f"{rel}:{p}" for rel, p in unresolved_all) or "(none)"
    findings.append(Finding(
        L3,
        f"the Ingress path could not be resolved to a literal: {shown}. It is templated "
        f"with no `default \"...\"` fallback, so this gate cannot confirm that {target} "
        f"is routed. Give the template a literal default so the shipped route is readable "
        f"from the chart."))


# --------------------------------------------------------------------------------------
# Layer 4a -- the web server (nginx), in either dialect
# --------------------------------------------------------------------------------------

_LOCATION_RE = re.compile(
    r"""location\s+(?:(?P<mod>=|\^~|~\*|~)\s*)?(?P<pat>\S+)\s*\{""")
_ROOT_RE = re.compile(r"^\s*root\s+(?P<v>[^;]+);", re.M)
_ALIAS_RE = re.compile(r"^\s*alias\s+(?P<v>[^;]+);", re.M)
_PROXY_RE = re.compile(r"^\s*(proxy_pass|return|deny)\b", re.M)

#: An nginx conf lives either as a file in the image or as a chart ConfigMap. Both are
#: the same dialect; a check that reads only one of them misses half the fleet
#: (FuzeKeys bakes `frontend/nginx.conf`; FuzeService mounts
#: `templates/nginx-configmap.yaml`).
NGINX_FILE_RE = re.compile(r"(^|/)(nginx[\w.-]*\.conf|default\.conf|[\w.-]*\.nginx)$")


def find_nginx_texts(root: str):
    out = []
    for rel, full in walk_files(root):
        if NGINX_FILE_RE.search(rel):
            out.append((rel, read_text(full)))
            continue
        if rel.endswith((".yaml", ".yml")):
            text = read_text(full)
            if "server {" in text and "location " in text:
                out.append((rel, text))
    return out


def _block(text: str, open_brace_idx: int) -> str:
    """The body of the block whose `{` is at open_brace_idx, brace-matched."""
    depth = 0
    for i in range(open_brace_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace_idx + 1:i]
    return text[open_brace_idx + 1:]


def parse_nginx(text: str):
    """(server_root, [ {pat, mod, body} ... ]) for prefix locations only.

    Regex locations (`~`, `~*`) are parsed but not used for prefix resolution: they
    match by pattern, typically a file extension, and do not decide which DIRECTORY a
    subtree is served from.
    """
    server_root = ""
    locations = []
    for m in _LOCATION_RE.finditer(text):
        body = _block(text, text.index("{", m.end() - 1))
        locations.append({"pat": m.group("pat"), "mod": m.group("mod") or "", "body": body})
    # A server-level `root` is any root directive that is not inside a location body.
    bodies = "".join(l["body"] for l in locations)
    for m in _ROOT_RE.finditer(text):
        if m.group(0) not in bodies:
            server_root = norm_fs_dir(m.group("v"))
            break
    return server_root, locations


#: A federated-mount-shaped location prefix: `/apps/<one-segment>/`. Deliberately
#: shape-based and NOT compared against the slug -- the point is to spot a mount block
#: whose prefix disagrees with the OTHER THREE LAYERS, never to assert what the prefix
#: ought to be named.
MOUNT_PREFIX_RE = re.compile(r"^/apps/[^/]+/?$")


def orphan_mounts(texts, serve_root):
    """Federated-mount `location`s that do NOT handle serve_root.

    THE SHAPE THIS EXISTS FOR, and it is the one that has now gone wrong five times in
    this fleet. FuzePicker #88 shipped:

        location ^~ /apps/fuzepicker/ { alias /usr/share/nginx/html/; }

    while its manifest, its vite `base` and its Ingress all say `/apps/picker/`. The
    block is present, correctly built, and DEAD -- nothing matches the advertised path,
    so the request falls through to `location /` and 404s. Without this check the gate
    still fails the repo, but blames `[L4b image-layout]` and tells FuzePicker to change
    its Dockerfile, when the actual fix (#89) is one word in the nginx prefix.

    Returns [(rel, directive, would_resolve_to)] where `directive` is reprinted with
    its modifier (`^~ /apps/x/`) so the message matches the line in the file, and
    `would_resolve_to` is the directory that block WOULD have served serve_root
    from, had its prefix matched.
    """
    out = []
    for rel, text in texts:
        server_root, locations = parse_nginx(text)
        for loc in locations:
            if loc["mod"] in ("~", "~*"):
                continue
            pat = loc["pat"]
            if not MOUNT_PREFIX_RE.match(pat):
                continue
            if serve_root.startswith(pat if pat.endswith("/") else pat + "/") \
                    or serve_root.rstrip("/") == pat.rstrip("/"):
                continue  # this block DOES handle the serve path; not an orphan
            alias = _ALIAS_RE.search(loc["body"])
            if alias:
                # `alias` replaces the whole matched prefix, so had the prefix been
                # serve_root the alias target is exactly what it would have served.
                would = norm_fs_dir(alias.group("v"))
            else:
                loc_root = _ROOT_RE.search(loc["body"])
                docroot = norm_fs_dir(loc_root.group("v")) if loc_root else server_root
                would = norm_fs_dir(docroot + serve_root) if docroot else None
            shown = f"{loc['mod']} {pat}".strip()
            out.append((rel, shown, would))
    return out


def resolve_nginx_dir(texts, serve_root, findings):
    """The filesystem directory nginx serves `serve_root` from, or None.

    THIS HALF ALONE PASSES FUZESERVICE, which is the point of splitting layer 4 in two.
    FuzeService's `location / { root /usr/share/nginx/html; }` resolves
    `/apps/service/remoteEntry.js` to exactly the right filesystem path. The conf is
    fine. Nothing ever put a file there -- see resolve_image_dir.
    """
    if not texts:
        # Deliberately silent: check_layer4 tries the Node dialect next and owns the
        # "nothing serves this" verdict. Reporting here would fire on every Node-served
        # repo, which is precisely the carve-out this dialect exists to remove.
        return None
    if False:
        findings.append(Finding(
            L4A,
            "no web-server configuration found. Both nginx dialects were searched -- a "
            "baked nginx*.conf / default.conf in the image, and a `server { ... location "
            "... }` block in the chart's ConfigMaps. A declared Module-Federation remote "
            "has to be served by something, so this is a finding rather than a skip. If "
            "this remote is deliberately served by a non-nginx static server (an Express "
            "app, a CDN), that is a real answer -- record it on the ratchet in "
            "governance/federation-contract-policy.json with the file that serves it, so "
            "the decision is written down instead of inferred from silence."))
        return None

    best = None  # (prefix_len, rel, loc, server_root)
    for rel, text in texts:
        server_root, locations = parse_nginx(text)
        for loc in locations:
            if loc["mod"] in ("~", "~*"):
                continue
            pat = loc["pat"]
            if not pat.startswith("/"):
                continue
            if loc["mod"] == "=":
                if serve_root.rstrip("/") != pat.rstrip("/"):
                    continue
            elif not serve_root.startswith(pat if pat.endswith("/") else pat + "/") \
                    and serve_root.rstrip("/") != pat.rstrip("/"):
                continue
            if best is None or len(pat) > best[0]:
                best = (len(pat), rel, loc, server_root)

    if best is None:
        rels = ", ".join(rel for rel, _ in texts)
        findings.append(Finding(
            L4A,
            f"no nginx `location` matches {serve_root} in {rels} -- not even a catch-all "
            f"`location /`. Requests for the remote's chunks are not handled by any block."))
        return None

    _plen, rel, loc, server_root = best
    if _PROXY_RE.search(loc["body"]):
        findings.append(Finding(
            L4A,
            f"{rel}: the `location {loc['mod']} {loc['pat']}` that handles {serve_root} "
            f"proxies or returns instead of serving files from disk. The remote's build "
            f"is static output; routing its path elsewhere means remoteEntry.js is "
            f"whatever the upstream answers, not the bundle."))
        return None

    alias = _ALIAS_RE.search(loc["body"])
    if alias:
        # `alias` REPLACES the matched prefix, so only the tail after the location
        # pattern is appended.
        head = norm_fs_dir(alias.group("v"))
        tail = serve_root[len(loc["pat"].rstrip("/")):].strip("/")
        return norm_fs_dir(posixpath.join(head, tail)) if tail else head

    loc_root = _ROOT_RE.search(loc["body"])
    docroot = norm_fs_dir(loc_root.group("v")) if loc_root else server_root
    if not docroot:
        findings.append(Finding(
            L4A,
            f"{rel}: the block handling {serve_root} declares neither `root` nor `alias`, "
            f"and no server-level `root` was found, so the directory this path is served "
            f"from is undeterminable. Declare it rather than relying on the image's "
            f"compiled-in default."))
        return None
    # `root` APPENDS the whole URI.
    return norm_fs_dir(docroot + serve_root)


# --------------------------------------------------------------------------------------
# Layer 4a, second dialect -- a Node/Express static mount
# --------------------------------------------------------------------------------------
#
# NGINX IS DECLARATIVE; NODE SERVING IS CODE, AND CODE CANNOT BE EXECUTED HERE. So this
# reader is deliberately built for an honest SUBSET -- a mount whose URL prefix and
# filesystem root are BOTH literals -- and everything outside that subset is reported as
# UNREADABLE rather than guessed. "Could not check" must never render as "fine"; that is
# the failure this whole gate exists to end, and a dynamic serve path is exactly the
# shape where it would sneak back in.
#
# THREE LIVE SHAPES DROVE THIS, and they are not the same as each other -- which is why
# each was read rather than assumed:
#
#   FuzeX          `const WEBAPP_MOUNT_PREFIX = '/apps/fuzex/'` + WEBAPP_DIR from
#                  `process.env.DESIGN_FRAMES_WEBAPP_DIR`, set literally in the
#                  Dockerfile (`ENV DESIGN_FRAMES_WEBAPP_DIR=/app/webapp-dist`), and the
#                  build copied exactly there. CORRECT -- and it must come out clean.
#   FuzeMarket     a hand-rolled `serveStatic()` joining the request path straight onto
#                  ROOT, i.e. a mount at `/`, with ROOT from `process.env.STATIC_DIR`
#                  (`ENV STATIC_DIR=/app/site`). The build lands at /app/site/dist, so
#                  /apps/market/remoteEntry.js resolves to /app/site/apps/market and
#                  404s. A real, unfixed defect.
#   FuzeMerchandize  no static mount at all -- the server only listens. Its remote is
#                  served by nothing, which stays a finding.

#: A server-ish source file. Kept narrow so the walk does not read every .js in the repo.
NODE_SERVER_RE = re.compile(r"\.(m?js|cjs|ts)$")
NODE_SERVER_HINT = ("express(", "express.static", "createServer", "http.createServer")

#: `ENV KEY=value` / `ENV KEY value`, after line-continuations are joined.
_DOCKER_ENV_RE = re.compile(r"(?:^|\s)([A-Z_][A-Z0-9_]*)=([^\s\\]+)")
_DOCKER_ENV_LINE_RE = re.compile(r"^\s*ENV\s+(?P<rest>.+?)\s*$", re.M | re.I)

#: `const NAME = ... process.env.X ... 'literal' ...` — a static-root variable.
_ROOT_VAR_RE = re.compile(
    r"""(?:const|let|var)\s+(?P<name>\w+)\s*=\s*(?P<rhs>[^;\n]+)""")
_ENV_REF_RE = re.compile(r"process\.env\.(?P<var>\w+)")
_ABS_LITERAL_RE = re.compile(r"""['"](?P<v>/[^'"]*)['"]""")

#: A mount-prefix constant: `const WEBAPP_MOUNT_PREFIX = '/apps/fuzex/'`.
_MOUNT_CONST_RE = re.compile(
    r"""(?:const|let|var)\s+\w*(?:MOUNT|PREFIX|BASE_?PATH|PUBLIC_?PATH)\w*\s*=\s*"""
    r"""['"](?P<v>/[^'"]*)['"]""", re.I)

#: `app.use('/prefix', express.static(root))` and the bare `app.use(express.static(root))`.
_EXPRESS_PREFIXED_RE = re.compile(
    r"""\.use\(\s*['"](?P<prefix>/[^'"]*)['"]\s*,\s*express\.static\(\s*(?P<root>[^)]*)\)""")
_EXPRESS_BARE_RE = re.compile(r"""\.use\(\s*express\.static\(\s*(?P<root>[^)]*)\)""")

#: A name that plausibly holds a STATIC root, used only to choose between several
#: resolved candidates -- never to admit one that is not otherwise a mount.
_STATIC_NAME_RE = re.compile(r"STATIC|ROOT|PUBLIC|WEB|SITE|DIST|ASSET", re.I)


def dockerfile_env(dockerfiles):
    """Literal `ENV` values across this repo's Dockerfiles.

    This is what makes `process.env.STATIC_DIR` readable at all: the value is not in the
    server source, it is in the image definition, and the two are one artifact.
    """
    env = {}
    for _rel, text in dockerfiles:
        joined = re.sub(r"\\\s*\n", " ", text)
        for m in _DOCKER_ENV_LINE_RE.finditer(joined):
            for k, v in _DOCKER_ENV_RE.findall(" " + m.group("rest")):
                env.setdefault(k, v.strip().strip('"').strip("'"))
    return env


def _resolve_root_expr(rhs, env, var_literals):
    """A filesystem root from an expression, or None when it is not statically knowable.

    Order matters: an env var the image actually sets WINS over the in-source fallback,
    because that is what the container runs with.
    """
    for m in _ENV_REF_RE.finditer(rhs):
        val = env.get(m.group("var"))
        if val and val.startswith("/"):
            return norm_fs_dir(val)
    m = _ABS_LITERAL_RE.search(rhs)
    if m:
        return norm_fs_dir(m.group("v"))
    name = rhs.strip()
    if name in var_literals:
        return var_literals[name]
    return None


def node_static_mounts(texts, env):
    """[(rel, line, prefix, root_or_None)] -- every readable static mount, plus the
    unreadable ones with root None so the caller can report them rather than drop them."""
    out = []
    for rel, text in texts:
        var_literals, unresolved_vars = {}, {}
        for m in _ROOT_VAR_RE.finditer(text):
            rhs = m.group("rhs")
            if "path." not in rhs and "process.env" not in rhs:
                continue
            line = text[:m.start()].count("\n") + 1
            got = _resolve_root_expr(rhs, env, var_literals)
            if got:
                var_literals[m.group("name")] = got
            elif _STATIC_NAME_RE.search(m.group("name")):
                unresolved_vars[m.group("name")] = line

        def root_of(expr):
            expr = expr.strip()
            if expr in var_literals:
                return var_literals[expr]
            return _resolve_root_expr(expr, env, var_literals)

        found_explicit = False
        for m in _EXPRESS_PREFIXED_RE.finditer(text):
            line = text[:m.start()].count("\n") + 1
            out.append((rel, line, as_dir(m.group("prefix")), root_of(m.group("root"))))
            found_explicit = True
        for m in _EXPRESS_BARE_RE.finditer(text):
            if _EXPRESS_PREFIXED_RE.search(text[max(0, m.start() - 200):m.end()]):
                continue
            line = text[:m.start()].count("\n") + 1
            out.append((rel, line, "/", root_of(m.group("root"))))
            found_explicit = True

        # A hand-rolled mount: a literal prefix constant (FuzeX) or, failing that, a
        # static root joined with the request path and therefore mounted at `/`
        # (FuzeMarket).
        #
        # ALWAYS emitted, never gated on "no express mount was found". A server can use
        # Express for side-assets AND a custom handler for the app itself, and suppressing
        # the hand-rolled candidate there made the gate announce that NOTHING served the
        # remote -- a confident, wrong finding, on a repo that serves it fine. The `/`
        # prefix is the weakest possible match, so resolve_node_dir's longest-prefix rule
        # lets any genuinely more specific mount win, exactly as nginx's `location /`
        # yields to a longer prefix.
        consts = [m.group("v") for m in _MOUNT_CONST_RE.finditer(text)]
        roots = [(n, v) for n, v in var_literals.items() if _STATIC_NAME_RE.search(n)]
        seen_roots = {r for _rel, _l, _p, r in out if r}
        if roots:
            name, rootdir = roots[0]
            if not (found_explicit and rootdir in seen_roots):
                line = text[:text.index(name)].count("\n") + 1 if name in text else 1
                out.append((rel, line, as_dir(consts[0]) if consts else "/", rootdir))
        elif unresolved_vars and not found_explicit:
            name, line = sorted(unresolved_vars.items(), key=lambda kv: kv[1])[0]
            out.append((rel, line, as_dir(consts[0]) if consts else "/", None))
    return out


def find_node_servers(root: str):
    out = []
    for rel, full in walk_files(root):
        if not NODE_SERVER_RE.search(rel):
            continue
        if "/test" in rel or rel.endswith((".test.js", ".spec.js", ".d.ts")):
            continue
        text = read_text(full)
        if not any(h in text for h in NODE_SERVER_HINT):
            continue
        out.append((rel, text))
    return out


def resolve_node_dir(texts, env, serve_root, findings):
    """The directory a Node server serves `serve_root` from, or None.

    Mirrors resolve_nginx_dir exactly, because the semantics are the same: a prefixed
    mount STRIPS its prefix (like nginx `alias`), a `/` mount appends the whole path
    (like nginx `root`). Only mounts that could plausibly serve serve_root are
    considered -- an `app.use('/images', ...)` is not the federated mount and must not be
    mistaken for one, which is how an over-firing gate produces confident, wrong findings.
    """
    if not texts:
        return None
    mounts = node_static_mounts(texts, env)
    if not mounts:
        return None

    best = None
    for rel, line, prefix, rootdir in mounts:
        if not (serve_root.startswith(prefix) or serve_root.rstrip("/") == prefix.rstrip("/")):
            continue
        if rootdir is None:
            findings.append(Finding(
                L4A,
                f"UNREADABLE (dynamic serve path in {rel}:{line}). A static mount is "
                f"declared for {prefix}, but its filesystem root is computed at runtime "
                f"rather than being a literal, so this gate cannot confirm that "
                f"{serve_root} resolves to where the build is. That is a FINDING, not a "
                f"skip: a repo whose serve path cannot be verified is not the same as one "
                f"that has none. Make the root a literal, or set it from a Dockerfile "
                f"`ENV` this gate can read."))
            return None
        if best is None or len(prefix) > len(best[0]):
            best = (prefix, rootdir)
    if best is None:
        return None
    prefix, rootdir = best
    tail = serve_root[len(prefix.rstrip("/")):].strip("/")
    return norm_fs_dir(posixpath.join(rootdir, tail)) if tail else norm_fs_dir(rootdir)


def node_orphan_mounts(texts, env, serve_root):
    """Federated-mount-shaped Node mounts that do NOT handle serve_root -- the Node
    equivalent of a `location ^~ /apps/wrong/` block, e.g. a repo whose slug moved but
    whose `MOUNT_PREFIX` constant did not."""
    out = []
    for rel, _line, prefix, rootdir in node_static_mounts(texts, env):
        if not MOUNT_PREFIX_RE.match(prefix.rstrip("/") or "/"):
            continue
        if serve_root.startswith(prefix) or serve_root.rstrip("/") == prefix.rstrip("/"):
            continue
        out.append((f"{rel} (`{prefix}` static mount)", prefix, rootdir))
    return out

# --------------------------------------------------------------------------------------
# Layer 4b -- where the Dockerfile actually puts the build
# --------------------------------------------------------------------------------------

_COPY_RE = re.compile(r"^\s*COPY\s+(?P<rest>.+?)\s*$", re.M | re.I)
_WORKDIR_RE = re.compile(r"^\s*WORKDIR\s+(?P<v>\S+)", re.M | re.I)


def find_dockerfiles(root: str):
    out = []
    for rel, full in walk_files(root):
        base = os.path.basename(rel)
        if base == "Dockerfile" or base.startswith("Dockerfile."):
            out.append((rel, read_text(full)))
    return out


_FROM_RE = re.compile(r"^\s*FROM\s+", re.M | re.I)


def final_stage(text: str) -> str:
    """The last `FROM` block -- the only stage whose filesystem becomes the image."""
    joined = re.sub(r"\\\s*\n", " ", text)
    starts = [m.start() for m in _FROM_RE.finditer(joined)]
    return joined[starts[-1]:] if starts else joined


def copy_pairs(text: str):
    """[(src_list, dest)] from every COPY, with line continuations joined."""
    joined = re.sub(r"\\\s*\n", " ", text)
    out = []
    for m in _COPY_RE.finditer(joined):
        rest = m.group("rest")
        if rest.strip().startswith("["):
            try:
                parts = json.loads(rest.strip())
            except ValueError:
                continue
        else:
            parts = [p for p in rest.split() if not p.startswith("--")]
        if len(parts) < 2:
            continue
        out.append((parts[:-1], parts[-1]))
    return out


#: Web-server bases whose final stage means "this image serves static files".
_WEBSERVER_BASE_RE = re.compile(r"^\s*FROM\s+\S*(nginx|caddy|httpd|apache)", re.M | re.I)


def serving_dockerfiles(dockerfiles, dialect, server_rel):
    """The Dockerfile(s) that build the image ACTUALLY SERVING the remote.

    A repo has several images -- backend, frontend, jobs -- and comparing a COPY in one
    against the document root of another is a cross-image comparison that means nothing.
    Measured on fuzebi: its ROOT Dockerfile is the BACKEND service and legitimately copies
    /app/dist into /app/dist; its frontend/Dockerfile is the nginx image and copies only
    an index.html. Pairing the first with the second's docroot produced a confident,
    specific, wrong finding telling fuzebi to "mount /apps/fuzebi/ onto /app/dist" -- a
    path in a different container. The truthful verdict is the plainer one: nothing copies
    the build into the serving image.

    Falls back to every Dockerfile when nothing matches, so a repo using an unrecognised
    base is still checked rather than silently skipped.
    """
    if dialect == "nginx":
        hits = [(rel, t) for rel, t in dockerfiles if _WEBSERVER_BASE_RE.search(final_stage(t))]
    else:
        base = os.path.basename(server_rel or "")
        hits = [(rel, t) for rel, t in dockerfiles if base and base in final_stage(t)]
    return hits or dockerfiles


def resolve_image_dir(dockerfiles, cfg, nginx_dir, serve_root, findings):
    """Where the remote's build output lands in the image, or None.

    The build output is identified by the bundler's own `outDir` where one is
    declared, falling back to the conventional dist/build names. This is the half
    FuzeService failed: `COPY --from=builder /app/packages/fuze-service/dist-mfe
    /usr/share/nginx/html` -- flat, with the nginx conf expecting
    /usr/share/nginx/html/apps/service.
    """
    if not dockerfiles:
        findings.append(Finding(
            L4B,
            "no Dockerfile found, so where this remote's build lands in the served image "
            "is unknown. This is the half of layer 4 that a check reading only the nginx "
            "conf misses, and it is the half FuzeService shipped broken -- so an absent "
            "Dockerfile is a finding, not a pass."))
        return None

    out_dir = os.path.basename((cfg.out_dir if cfg else "dist").rstrip("/")) or "dist"
    names = {out_dir, "dist", "build", "dist-mfe", "out"}
    candidates = []  # (rel, dest, src)
    for rel, text in dockerfiles:
        # ONLY THE FINAL STAGE SHIPS. A multi-stage Dockerfile's builder stages are
        # scaffolding: `COPY . .` under `FROM node:20 AS builder` puts the build at
        # /app/dist inside a layer that is then thrown away. Counting those made the gate
        # report fuzebi's build as living at /app/dist and reason about where it "should"
        # be moved, when the truth is starker and more useful -- nothing copies it into
        # the serving image at all. Measured on fuzebi and fuzeexecutive, whose final
        # stages copy only an index.html.
        stage = final_stage(text)
        workdir = "/"
        for wm in _WORKDIR_RE.finditer(stage):
            workdir = wm.group("v")
        for srcs, dest in copy_pairs(stage):
            for src in srcs:
                stem = os.path.basename(src.rstrip("/"))
                if stem in names:
                    d = dest if dest.startswith("/") else posixpath.join(workdir, dest)
                    candidates.append((rel, norm_fs_dir(d), src))
                    break

    if not candidates:
        rels = ", ".join(rel for rel, _ in dockerfiles)
        findings.append(Finding(
            L4B,
            f"no Dockerfile COPY of the remote's build output was found (looked for a "
            f"source directory named one of {sorted(names)} in {rels}). Nothing in this "
            f"repo demonstrably places the bundle into the served image."))
        return None

    if nginx_dir is not None:
        for _rel, dest, _src in candidates:
            if dest == nginx_dir:
                return dest
    # Prefer the candidate that at least lands under the serve path, so the message
    # names the most plausible intended COPY.
    for rel, dest, src in candidates:
        if serve_root != "/" and dest.endswith(serve_root.rstrip("/")):
            return dest
    return candidates[0][1]


def check_layer4(root, serve_root, cfg, findings):
    """Layer 4 across BOTH serving dialects.

    nginx is tried first because it is declarative and therefore knowable; the Node
    dialect is tried second and, unlike nginx, can return an explicit UNREADABLE finding
    when the mount is computed rather than literal. Only when NEITHER dialect yields a
    serve directory -- and neither has already said why -- does this report that nothing
    serves the remote at all. Applicability is still the manifest's business: reaching
    here at all means the repo DECLARED module-federation.
    """
    dockerfiles = find_dockerfiles(root)
    env = dockerfile_env(dockerfiles)

    nginx_texts = find_nginx_texts(root)
    before = len(findings)
    serve_dir = resolve_nginx_dir(nginx_texts, serve_root, findings)
    dialect_failed = len(findings) > before
    orphans_of = lambda: orphan_mounts(nginx_texts, serve_root)
    dialect = "nginx"
    server_rel = ""

    if serve_dir is None and not dialect_failed:
        node_texts = find_node_servers(root)
        before = len(findings)
        node_dir = resolve_node_dir(node_texts, env, serve_root, findings)
        if len(findings) > before:
            dialect_failed = True
        if node_dir is not None:
            serve_dir = node_dir
            dialect = "node"
            server_rel = next((r for r, _t in node_texts), "")
            orphans_of = lambda: node_orphan_mounts(node_texts, env, serve_root)
        elif not dialect_failed:
            node_orphans = node_orphan_mounts(node_texts, env, serve_root)
            if node_orphans:
                orphans_of = lambda: node_orphans

    if serve_dir is None and not dialect_failed:
        findings.append(Finding(
            L4A,
            "nothing in this repo serves the declared Module-Federation remote. BOTH "
            "dialects were searched: an nginx `location`/`alias` (a baked nginx*.conf or "
            "a chart ConfigMap), and a Node/Express static mount with a literal URL "
            "prefix and filesystem root. A repo that declares module-federation must be "
            "served by something, so this is a finding rather than a skip. If a mount "
            "exists but is computed at runtime, make its root a literal or set it from a "
            "Dockerfile `ENV` -- an unreadable serve path is reported as UNREADABLE, "
            "never as clean."))

    nginx_dir = serve_dir
    nginx_failed = dialect_failed

    before = len(findings)
    image_dir = resolve_image_dir(
        serving_dockerfiles(dockerfiles, dialect, server_rel),
        cfg, nginx_dir, serve_root, findings)
    image_failed = len(findings) > before

    if nginx_dir is None or image_dir is None or nginx_dir == image_dir:
        return
    if nginx_failed or image_failed:
        return

    # A DEAD FEDERATED-MOUNT BLOCK OUTRANKS THE GENERIC ATTRIBUTION BELOW.
    #
    # Only consulted once layer 4 is already known broken (we returned above if the two
    # halves agreed), so a host legitimately serving several remotes -- where every mount
    # resolves correctly -- can never trip this. When something IS broken and a
    # mount-shaped `location` sits there on a prefix none of the other three layers uses,
    # that block is the defect, and saying so is the difference between "change one word
    # in nginx.conf" and "restructure your Dockerfile".
    orphans = orphans_of()
    for rel, pat, would in orphans:
        if would is not None and would == image_dir:
            # Decisive: had the prefix matched, this block would have served the build
            # exactly where the image puts it. The image layout is RIGHT for the design
            # the repo chose; only the prefix is wrong.
            findings.append(Finding(
                L4A,
                f"{rel}: `location {pat}` is a federated-mount block on a prefix nothing "
                f"else uses. The manifest, the bundler `base` and the Ingress all serve "
                f"{serve_root}, so this block never matches, the request falls through to "
                f"the catch-all, and remoteEntry.js 404s -- a blank panel behind a green "
                f"healthcheck. Its alias/root already points at {would}, which is exactly "
                f"where the Dockerfile puts the build, so THE IMAGE LAYOUT IS CORRECT and "
                f"the Dockerfile must NOT be changed: fix the prefix to {serve_root}. "
                f"Change nginx, never the manifest and never the slug -- a slug is "
                f"immutable, and editing one registers a second app and strands the first."))
            return
    for rel, pat, would in orphans:
        findings.append(Finding(
            L4A,
            f"{rel}: `location {pat}` is a federated-mount block on a prefix none of the "
            f"other three layers uses (they serve {serve_root}), so it is dead config. "
            f"Fix the prefix in nginx -- not the manifest, and never the slug."))

    # ATTRIBUTION. Both halves are candidates for "the wrong one", so the tie-break is
    # which half agrees with the serve path the other three layers already settled.
    # FuzeService: image_dir=/usr/share/nginx/html does NOT end with /apps/service,
    # nginx_dir=/usr/share/nginx/html/apps/service does -> the image layout is wrong.
    tail = serve_root.rstrip("/")
    image_ok = bool(tail) and image_dir.endswith(tail)
    # THE DOCKERFILE IS BLAMED ONLY ON POSITIVE EVIDENCE, never as the default.
    #
    # `nginx_dir.endswith(tail)` alone is too weak: it is true for ANY root-style mount,
    # so it made every root-mounted repo a Dockerfile problem. FuzeService/FuzeSocial
    # genuinely are -- their COPY lands the build EXACTLY on the document root, the
    # signature of a forgotten prefix, which is `image_dir + serve_root == serve_dir`.
    # FuzeMarket is not: its build lands at /app/site/dist, a third location matching
    # neither the serve path nor the document root, so nothing suggests a flat copy was
    # intended and the missing piece is the MOUNT. Blaming its Dockerfile would be the
    # same misdiagnosis as telling FuzePicker to restructure its image.
    flat_at_docroot = norm_fs_dir(image_dir + serve_root) == nginx_dir

    shown = "nginx" if dialect == "nginx" else "the Node static mount"
    msg = (f"{shown} serves {serve_root} from {nginx_dir}, but the Dockerfile places the "
           f"build at {image_dir}. remoteEntry.js and every chunk it imports 404 -- a "
           f"blank panel behind a green healthcheck, which is the exact failure "
           f"governance/naming-and-addressing.md named and FuzeService shipped anyway.")
    if flat_at_docroot and not image_ok:
        findings.append(Finding(
            L4B,
            msg + f" The build is copied FLAT onto the document root: the image must "
                  f"place it at {nginx_dir}."))
    elif image_ok and not flat_at_docroot:
        findings.append(Finding(
            L4A,
            msg + f" The image layout matches {serve_root}; {shown} points somewhere "
                  f"else and must resolve to {image_dir}."))
    else:
        findings.append(Finding(
            L4A,
            msg + f" The build is at {image_dir}, which matches neither {serve_root} nor "
                  f"the served root, so no flat copy was intended and the missing piece "
                  f"is the MOUNT. Either mount {serve_root} onto {image_dir}, or move the "
                  f"build to {nginx_dir} -- both are valid; pick one deliberately rather "
                  f"than changing the Dockerfile by reflex."))


# --------------------------------------------------------------------------------------
# Policy / ratchet
# --------------------------------------------------------------------------------------

POLICY_CANDIDATES = (
    ("governance", "federation-contract-policy.json"),
    (".fuze", "federation-contract-policy.json"),
)

#: FAIL-CLOSED. A repo with no policy file gets the strict gate. Defaulting to `warn`
#: would mean deleting one file silences the gate -- the vacuous-green shape this exists
#: to end.
DEFAULT_POLICY = {"mode": "fail", "ratchet": {"knownFailing": {}}}


def load_policy(root: str, explicit: str = ""):
    path = explicit
    if not path:
        for parts in POLICY_CANDIDATES:
            cand = os.path.join(root, *parts)
            if os.path.isfile(cand):
                path = cand
                break
    if not path:
        return DEFAULT_POLICY, ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), path
    except (OSError, ValueError) as exc:
        raise SystemExit(f"gate-federation-contract: policy {path} unreadable: {exc}")


def repo_key(root: str, explicit: str = "") -> str:
    """Short repo name, lowercased -- `izzywdev/FuzeService` -> `fuzeservice`."""
    name = explicit or os.environ.get("GITHUB_REPOSITORY", "")
    if not name:
        try:
            with open(os.path.join(root, ".fuze", "manifest.json"), encoding="utf-8") as f:
                name = str(json.load(f).get("repo", ""))
        except (OSError, ValueError):
            name = ""
    if not name:
        name = os.path.basename(os.path.abspath(root))
    return name.split("/")[-1].lower()


# --------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------

def evaluate(root: str):
    """(status, declared_type, findings). status in {SKIPPED, CHECKED}."""
    findings = []
    primary, vendored = find_registration_manifests(root)
    if primary is None:
        # This repo registers no portal app, so it has no serve contract. WHETHER it
        # should have one is gate-registration's question (check-registration.mjs check
        # 5), not this gate's -- and the two must not both claim it.
        return "SKIPPED", "no registration/manifest.json at the repo root", findings

    manifest, entry_path = check_manifest(root, primary, vendored, findings)
    integration = manifest.get("integration")
    declared = None
    if isinstance(integration, dict):
        declared = integration.get("type")

    if declared is not None and str(declared).lower() not in MF_TYPES:
        # A DECLARED non-remote. The only legitimate skip, and it is reported with the
        # type so the reader can see what was declared rather than what was guessed.
        return "SKIPPED", f"integration.type: {declared}", []

    if declared is None:
        # `integration` exists but does not say what kind of integration this is. That is
        # a defect, NOT a skip: applicability is declared, never inferred, and an
        # undeclared one must fail closed. The alternative -- treating "I could not tell"
        # as "not applicable" -- is precisely how a gate becomes decorative.
        findings.append(Finding(
            L1,
            f"{primary} declares an `integration` object with no `type`, so whether this "
            f"repo is a Module-Federation remote is not declared anywhere. Applicability "
            f"is declared, never inferred; an undeclared integration.type fails closed. "
            f"Declare one of: module-federation, iframe, spa."))
        return "CHECKED", "integration.type: <absent>", findings

    cfgs = find_build_configs(root)
    cfg = pick_build_config(cfgs, manifest, entry_path)
    serve_root = check_build_config(cfg, cfgs, entry_path, findings)
    if serve_root is None:
        serve_root = as_dir(posixpath.dirname(entry_path)) if entry_path else "/"

    check_ingress(root, entry_path, serve_root, findings)
    check_layer4(root, serve_root, cfg, findings)
    return "CHECKED", f"integration.type: {declared}", findings


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    ap.add_argument("--repo", default="", help="owner/name, for the ratchet lookup")
    ap.add_argument("--policy", default="", help="path to a policy JSON")
    args = ap.parse_args(argv)

    root = os.path.abspath(args.root)
    policy, policy_path = load_policy(root, args.policy)
    mode = str(policy.get("mode", "fail")).lower()
    key = repo_key(root, args.repo)
    known = ((policy.get("ratchet") or {}).get("knownFailing") or {}).get(key) or {}
    ramped = set(known.get("layers") or [])

    status, reason, findings = evaluate(root)

    hard = [f for f in findings if mode == "fail" or (mode != "warn" and f.layer not in ramped)]
    soft = [f for f in findings if f not in hard]

    if args.json:
        print(json.dumps({
            "repo": key, "status": status, "reason": reason, "mode": mode,
            "policy": os.path.relpath(policy_path, root) if policy_path else None,
            "findings": [{"layer": f.layer, "message": f.message} for f in findings],
            "failing": [f.layer for f in hard],
        }, indent=2))
        return 1 if hard else 0

    if status == "SKIPPED":
        print(f"gate-federation-contract: SKIPPED ({reason}) -- {key}")
        return 0

    print(f"gate-federation-contract: CHECKED ({reason}) -- {key}, mode={mode}")
    for f in soft:
        print(f"::warning title=gate-federation-contract::{f}")
    for f in hard:
        print(f"::error title=gate-federation-contract::{f}")

    if ramped and not any(f.layer in ramped for f in findings):
        print(f"::notice title=gate-federation-contract::the ratchet entry for '{key}' "
              f"lists {sorted(ramped)} but none of those layers reports a finding any "
              f"more. Remove the entry from {os.path.basename(policy_path)} so the ramp "
              f"cannot re-open.")

    if hard:
        print(f"\ngate-federation-contract FAILED: {len(hard)} finding(s). "
              f"The four layers are one contract and must agree with EACH OTHER. "
              f"They are NOT required to match the slug, and no fix here ever edits a "
              f"slug -- see governance/naming-and-addressing.md.")
        return 1
    if soft:
        print(f"\ngate-federation-contract: {len(soft)} finding(s) held by the ratchet "
              f"for '{key}'. These fail once the policy mode flips.")
    else:
        print("gate-federation-contract: all four layers agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
