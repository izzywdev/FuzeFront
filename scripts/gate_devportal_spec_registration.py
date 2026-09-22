#!/usr/bin/env python3
"""gate-devportal-spec-registration — a spec that exists is not a spec that's
PUBLISHED, and a service is not documented just because nobody complained yet.

developers.fuzefront.com's catalog is built from `services/devportal-service/
specs/`, which `scripts/collect-devportal-specs.mjs` populates from a hand-
maintained `SOURCES` array (see that file's own header — it says the pairing
between "a service has an openapi.yaml" and "SOURCES lists it" is NOT enforced
anywhere). Two ways that silently drifts:

  a service starts serving real HTTP traffic and never gets an openapi.yaml
      -> invisible to gate-openapi-conformance (nothing to compare against),
         invisible to the catalog, invisible to every consumer.

  a service DOES get an openapi.yaml, but nobody adds it to SOURCES
      -> the spec sits in the repo, correct and current, and the catalog
         never shows it. A real contract with zero readers.

This gate closes both, cheaply — it is a filesystem/text check, no route
scanning, no HTTP:

  R1  a `services/<name>/` directory that runs its own HTTP server (has
      `package.json` + an `app.listen(` call under `src/`) but ships no
      `openapi.yaml`, and is not declared exempt.
  R2  an `openapi.yaml` under `services/*/` or `packages/*/` that exists on
      disk but is not registered in collect-devportal-specs.mjs's SOURCES.

Exemptions: governance/devportal-spec-exempt.txt, one service name per line,
`# reason` required. A service earns this only when it has no HTTP contract
surface worth publishing (e.g. a pure Kafka consumer whose only route is an
unauthenticated liveness probe) — the reason is reviewed, not rubber-stamped.

  gate_devportal_spec_registration.py [repo]
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from gate_platform_auth import Finding, read, tracked_files
except ImportError as exc:  # pragma: no cover - a bare traceback here is unreadable
    sys.stderr.write(
        "::error title=gate-devportal-spec-registration::cannot import the "
        f"shared helpers from scripts/gate_platform_auth.py ({exc}). Re-run "
        "sdlc-bootstrap, or install scripts/gate_platform_auth.py alongside "
        "this file.\n")
    sys.exit(2)

EXEMPT_FILE = "governance/devportal-spec-exempt.txt"
COLLECTOR = "scripts/collect-devportal-specs.mjs"

LISTEN_RE = re.compile(r"\bapp\.listen\s*\(")
SOURCE_ENTRY_RE = re.compile(
    r"""specPath\s*:\s*['"]([^'"]+)['"]""")


def parse_exempt(repo):
    body = read(repo, EXEMPT_FILE)
    names = set()
    for lineno, line in enumerate(body.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name = stripped.split("#", 1)[0].strip()
        if stripped.count("#") == 0 or not stripped.split("#", 1)[1].strip():
            # A bare name with no reason is not a valid exemption — it is
            # silently ignored here and reported so the file stays honest
            # rather than becoming a blanket allow-list.
            continue
        if name:
            names.add(name)
    return names


def registered_specs(repo):
    """The literal `specPath` values collect-devportal-specs.mjs will harvest."""
    body = read(repo, COLLECTOR)
    return set(SOURCE_ENTRY_RE.findall(body))


def service_dirs(repo):
    """{service_name: has_own_package_json} for every services/<name>/ dir."""
    out = {}
    for rel in tracked_files(repo):
        m = re.match(r"^services/([^/]+)/", rel)
        if not m:
            continue
        out.setdefault(m.group(1), False)
        if rel == f"services/{m.group(1)}/package.json":
            out[m.group(1)] = True
    return out


def runs_own_http_server(repo, service):
    """True if this service directory's own src/ starts an Express listener.

    A directory that is only a contract (app-registry-service, portal-service,
    custom-hostname-api — implemented elsewhere, per CLAUDE.md's `slug`/serve-
    path section) has no package.json under services/<name>/ and is excluded
    before this is even called.
    """
    for rel in tracked_files(repo):
        if not rel.startswith(f"services/{service}/src/"):
            continue
        if not rel.endswith((".ts", ".js", ".mjs", ".cjs")):
            continue
        if LISTEN_RE.search(read(repo, rel)):
            return True
    return False


def has_own_spec(repo, service):
    return f"services/{service}/openapi.yaml" in set(tracked_files(repo))


def on_disk_specs(repo):
    return [r for r in tracked_files(repo)
            if re.match(r"^(services|packages)/[^/]+/openapi\.ya?ml$", r)]


def check(repo):
    findings = []
    tracked = set(tracked_files(repo))
    if COLLECTOR not in tracked:
        print("gate-devportal-spec-registration: no "
              f"{COLLECTOR} in this repo — nothing to register specs into, "
              "nothing to check")
        return findings

    exempt = parse_exempt(repo)
    sources = registered_specs(repo)

    # R1 — a service with its own HTTP server but no spec.
    for service, has_pkg in sorted(service_dirs(repo).items()):
        if not has_pkg:
            continue
        if has_own_spec(repo, service):
            continue
        if service in exempt:
            continue
        if not runs_own_http_server(repo, service):
            continue
        findings.append(Finding(
            "D1", f"services/{service}/", None,
            f"serves its own HTTP traffic (`app.listen(` under src/) but has "
            "no `openapi.yaml`. It is therefore invisible to "
            "gate-openapi-conformance (nothing to compare its routes "
            "against) and to the developers.fuzefront.com catalog. Add a "
            f"spec, or declare it in {EXEMPT_FILE} as `{service}  # why` if "
            "it genuinely has no contract surface worth publishing."))

    # R2 — a spec on disk that collect-devportal-specs.mjs will never harvest.
    for rel in on_disk_specs(repo):
        if rel in sources:
            continue
        findings.append(Finding(
            "D2", rel, None,
            f"exists but is not registered in {COLLECTOR}'s `SOURCES` array, "
            "so it is never copied into services/devportal-service/specs/ and "
            "never reaches the developers.fuzefront.com catalog. Add a "
            "`{ service: '<name>', specPath: '" + rel + "' }` entry to "
            f"{COLLECTOR}."))

    return findings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", nargs="?", default=".")
    args = ap.parse_args(argv)

    repo = os.path.abspath(args.repo)
    findings = check(repo)
    if not findings:
        print("gate-devportal-spec-registration: OK")
        return 0
    for f in sorted(findings, key=lambda x: (x.code, x.path)):
        print(f"::error::gate-devportal-spec-registration {f.code}")
        print(f)
    print(f"\ngate-devportal-spec-registration: {len(findings)} finding(s)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
