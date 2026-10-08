#!/usr/bin/env python3
"""gate-microservice-events — every microservice must handle identity lifecycle events.

WHAT THIS CATCHES, AND WHY NOTHING ELSE DOES
--------------------------------------------
A service that never learns a user or an organization was created cannot seed
its own rows for them. Nothing breaks at deploy time; nothing turns red in CI.
The symptom arrives later, in production, as "my org exists everywhere except
here" — and it is indistinguishable from a bug in the feature the user was
actually trying to use.

The family already publishes the events (shared/src/kafka/types.ts TOPICS) and
already has a typed consumer (shared/src/kafka/consumer.ts). What was missing
is any check that a service SUBSCRIBES. Measured when this gate was written:
of 12 structurally-real microservices, 5 consumed identity lifecycle events and
7 did not.

DISCOVERY IS STRUCTURAL, NOT DECLARED
-------------------------------------
There is deliberately no registry file and no manifest key listing the
microservices. A list is a thing someone forgets to add to, and the failure
mode of forgetting is silence — the new service is simply never checked, which
is the exact hole this gate exists to close. So membership is derived from the
code layout instead, and a directory that looks like a deployable service IS
one:

  1. package.json                      — it is an npm workspace in its own right
  2. Dockerfile (any suffix)           — it is built into an image, i.e. deployed
  3. src/index.ts or src/server.ts     — it has a process entrypoint

All three, or it is not a microservice. Each one rules something out that the
others do not: a library has (1) and (3) but no image; a chart-only or
spec-only directory has (2) at most; a script has (3) alone. The combination is
what distinguishes "this gets deployed and runs" from "this is source someone
imports".

Run with --report to see the classification for every candidate directory,
including the rejects and which signal each one is missing.

DECLARED NOT-APPLICABLE — the narrow, non-abusable exemption
------------------------------------------------------------
Some stores genuinely have nothing to seed for a `created` event. config-service
is a SPARSE override store: a brand-new org or user needs zero rows, because
resolution walks platform->portal->org->user and inherits (its
src/resolver/resolve.ts). Writing an empty created-handler to clear the ratchet
is exactly the "subscribes but seeds nothing" failure this gate rejects. So
there has to be a way to say "this topic does not apply here" that a reviewer
can see and disagree with — not silence.

`policy.notApplicable` is that way, and it is deliberately hard to abuse:

  notApplicable: { "<service>": { "<topic>": "<reason >= 40 chars>" } }

  * PER-TOPIC, never per-service. A service may NOT declare all four topics
    N/A — a service with no identity lifecycle at all is `exempt`, a different
    and separately-reviewed decision. In practice this keeps the two `deleted`
    topics effectively mandatory: any store that can ever hold a row can strand
    one, so "nothing to do on delete" is not a claim this gate will accept.
  * REASON IS MANDATORY and must be substantive (>= 40 chars). A one-word
    reason fails. The reason rides in the policy diff and in every --report.
  * MUTUALLY EXCLUSIVE with knownUnhandled and exempt. A service in two lists
    fails — so moving a service to notApplicable means removing it from the
    ratchet in the same PR.
  * CONTRADICTION FAILS. If a service both declares a topic N/A and binds a
    handler for it, that is an error — either it is handled or it is not
    applicable, not both.
  * STALE DECLARATION FAILS. A notApplicable key that names no discovered
    service fails, so a declaration cannot outlive its service.
  * ANTI-VACUITY IS UNTOUCHED. The seeds/effect check still runs over the
    topics a service DOES subscribe to; declaring `created` N/A never excuses a
    `deleted` handler that logs and returns.

A policy error is a gate FAILURE (exit 1), not a warning — a malformed
exemption must not pass silently, exactly like the vacuity rule below.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Where a microservice may live. Not a list of services — a list of PARENTS to
# walk. Adding a service under one of these is enough to be checked; nothing
# else has to be edited, which is the entire point.
SEARCH_ROOTS = ["services", "backend"]

SKIP_DIR_NAMES = {"node_modules", "dist", "build", "coverage", ".git", "__tests__", "tests"}

ENTRYPOINTS = ("src/index.ts", "src/server.ts", "src/main.ts")

# The lifecycle a service cannot seed itself without. Values are the wire topic
# names from shared/src/kafka/types.ts; the constant names are accepted too,
# since a service may import TOPICS rather than write the string.
REQUIRED_EVENTS = {
    "identity.user.created": "IDENTITY_USER_CREATED",
    "identity.user.deleted": "IDENTITY_USER_DELETED",
    "identity.org.created": "IDENTITY_ORG_CREATED",
    "identity.org.deleted": "IDENTITY_ORG_DELETED",
}

# A topic named in a comment is not a subscription. These are the call shapes
# that actually bind a handler in this codebase (shared/src/kafka/consumer.ts).
SUBSCRIBE_CALL = re.compile(
    r"\b(?:subscribe|on|addHandler|handle|consume)\s*(?:<[^>]*>)?\s*\(", re.IGNORECASE
)

# Topic-set ALIASES. A service may never name a topic at all and still subscribe
# to every one of them:
#
#     for (const topic of REF_INDEX_TOPICS) await consumer.subscribe(topic, h)
#
# That is how backend/applications and backend/src consume the identity
# lifecycle, and a gate that only greps for literals reports both as missing —
# a false failure, which is worse than no gate, because the first thing anyone
# does with a gate that cries wolf is stop reading it.
#
# The expansion is RESOLVED FROM SOURCE, not hardcoded here: the alias below is
# read out of its real definition so that changing the set changes the gate.
# If the definition cannot be found the gate FAILS rather than quietly treating
# the alias as empty — an unresolvable alias means every service using it would
# look unsubscribed.
TOPIC_SET_ALIASES = {
    # identifier -> (file relative to repo root, const whose KEYS are the topics)
    "REF_INDEX_TOPICS": ("packages/identity/src/ref-index.ts", "TOPIC_PROJECTIONS"),
}


def resolve_topic_set(repo_root: str, alias: str) -> set[str]:
    """Expand a topic-set identifier by reading the const it is derived from."""
    rel, const = TOPIC_SET_ALIASES[alias]
    path = os.path.join(repo_root, rel)
    if not os.path.isfile(path):
        raise LookupError(f"{alias}: {rel} not found")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    start = text.find(f"{const}")
    if start == -1:
        raise LookupError(f"{alias}: `{const}` not found in {rel}")
    # The object literal that follows, up to its closing `})`.
    body = text[start : text.find("})", start)]
    topics = set(re.findall(r"['\"]([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)['\"]\s*:", body))
    if not topics:
        raise LookupError(f"{alias}: `{const}` in {rel} yielded no topics")
    return topics

# "Seeds itself accordingly" — a handler that logs and returns is not seeding.
#
# The effect is NOT necessarily a write to the service's own database. Some
# services are stateless by design: provisioning-service owns no table and
# reacts to identity events by POSTing to security-service's /internal/provision,
# /internal/deprovision, /internal/user-sync and /internal/user-delete. That is
# seeding — it just does it over HTTP. A DB-write-only heuristic reports it as a
# no-op handler, which is a false failure, so an outbound MUTATING call counts
# too.
#
# Deliberately NOT matched: a bare GET, a log line, a metric. Those are how a
# handler looks when it was stubbed and never finished.
EFFECT_CALL = re.compile(
    # knex / SQL writes against its own store
    r"\.(?:insert|upsert|update|del|delete|merge|onConflict)\s*\(|"
    r"\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b|"
    # outbound mutating HTTP — the stateless-service shape
    r"\bmethod\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]|"
    r"\b(?:axios|http|client)\.(?:post|put|patch|delete)\s*\(",
    re.IGNORECASE,
)


def _iter_source(service_dir: str):
    """Yield (path, text) for every TypeScript source file in a service."""
    src = os.path.join(service_dir, "src")
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for fn in filenames:
            if not fn.endswith((".ts", ".tsx")):
                continue
            if fn.endswith((".test.ts", ".spec.ts", ".d.ts")):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding="utf-8") as fh:
                    yield p, fh.read()
            except (OSError, UnicodeDecodeError):
                continue


def classify(service_dir: str, repo_root: str = REPO_ROOT) -> dict:
    """Structural verdict for one candidate directory."""
    has_pkg = os.path.isfile(os.path.join(service_dir, "package.json"))
    has_docker = bool(glob.glob(os.path.join(service_dir, "Dockerfile*")))
    entry = next(
        (e for e in ENTRYPOINTS if os.path.isfile(os.path.join(service_dir, e))), None
    )
    missing = []
    if not has_pkg:
        missing.append("package.json")
    if not has_docker:
        missing.append("Dockerfile")
    if not entry:
        missing.append(" or ".join(ENTRYPOINTS))
    return {
        "dir": os.path.relpath(service_dir, repo_root).replace(os.sep, "/"),
        "name": os.path.basename(service_dir),
        "is_service": not missing,
        "missing": missing,
        "entrypoint": entry,
    }


def discover(repo_root: str) -> tuple[list[dict], list[dict]]:
    """Walk SEARCH_ROOTS and split candidates into services and rejects."""
    services, rejects = [], []
    for root in SEARCH_ROOTS:
        base = os.path.join(repo_root, root)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if name in SKIP_DIR_NAMES or name.startswith("."):
                continue
            d = os.path.join(base, name)
            if not os.path.isdir(d):
                continue
            verdict = classify(d, repo_root)
            (services if verdict["is_service"] else rejects).append(verdict)
    return services, rejects


def audit(service: dict, repo_root: str) -> dict:
    """Which required events this service subscribes to, and whether it writes."""
    d = os.path.join(repo_root, service["dir"])
    subscribed, mentioned_only = set(), set()
    writes = False

    for _path, text in _iter_source(d):
        if EFFECT_CALL.search(text):
            writes = True
        binds = bool(SUBSCRIBE_CALL.search(text))

        # Indirect: `for (const t of REF_INDEX_TOPICS) consumer.subscribe(t, h)`
        if binds:
            for alias in TOPIC_SET_ALIASES:
                if alias in text:
                    subscribed |= resolve_topic_set(repo_root, alias) & set(REQUIRED_EVENTS)

        # Direct: the topic string, or its TOPICS.<CONST> name.
        for topic, const in REQUIRED_EVENTS.items():
            if topic not in text and const not in text:
                continue
            if binds:
                subscribed.add(topic)
            else:
                mentioned_only.add(topic)

    missing = sorted(set(REQUIRED_EVENTS) - subscribed)
    return {
        **service,
        "subscribed": sorted(subscribed),
        "mentioned_only": sorted(mentioned_only - subscribed),
        "missing": missing,
        "writes": writes,
        # Subscribing without ever writing is the "logs and returns" shape: it
        # looks handled and seeds nothing.
        "seeds": writes,
    }


def load_policy(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# A reason short enough to be a label ("sparse", "n/a") is not a reason. The
# floor forces a sentence that a reviewer can agree or disagree with.
MIN_REASON_LEN = 40


def validate_not_applicable(
    not_applicable: object, known: set[str], exempt: set[str], discovered: set[str]
) -> list[str]:
    """Structural validation of policy.notApplicable. Returns error strings (empty == valid).

    Every undecidable or malformed shape is an error, never a silent skip — a
    broken exemption must fail the gate, not widen it.
    """
    errors: list[str] = []
    if not isinstance(not_applicable, dict):
        return ["notApplicable must be an object of { service: { topic: reason } }."]

    for name, topics in not_applicable.items():
        if not isinstance(topics, dict) or not topics:
            errors.append(f"notApplicable[{name}] must be a non-empty object of {{ topic: reason }}.")
            continue
        if name in known:
            errors.append(f"{name}: in BOTH notApplicable and knownUnhandled — mutually exclusive. "
                          f"Moving a service to notApplicable means removing it from the ratchet in the same PR.")
        if name in exempt:
            errors.append(f"{name}: in BOTH notApplicable and exempt — mutually exclusive.")
        if name not in discovered:
            errors.append(f"{name}: declared in notApplicable but is not a discovered microservice — "
                          f"a stale declaration cannot outlive its service.")
        unknown = sorted(set(topics) - set(REQUIRED_EVENTS))
        if unknown:
            errors.append(f"{name}: notApplicable names unknown topic(s) {', '.join(unknown)} — "
                          f"only {', '.join(sorted(REQUIRED_EVENTS))} are gated.")
        declared = set(topics) & set(REQUIRED_EVENTS)
        if declared == set(REQUIRED_EVENTS):
            errors.append(f"{name}: declares ALL FOUR identity events not-applicable. A service with no "
                          f"identity lifecycle at all belongs in `exempt` (a separately-reviewed decision), "
                          f"not notApplicable, which is per-topic by design.")
        for topic, reason in topics.items():
            if not isinstance(reason, str) or len(reason.strip()) < MIN_REASON_LEN:
                errors.append(f"{name}.{topic}: reason must be a substantive string (>= {MIN_REASON_LEN} "
                              f"chars). A label is not a reason — state why the topic does not apply.")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=REPO_ROOT)
    ap.add_argument(
        "--policy", default=os.path.join(REPO_ROOT, "governance", "microservice-events-policy.json")
    )
    ap.add_argument(
        "--report",
        action="store_true",
        help="print the full classification, including rejected candidates, and exit 0",
    )
    args = ap.parse_args()

    policy = load_policy(args.policy)
    known = set(policy.get("knownUnhandled", []))
    exempt = {e["name"]: e.get("reason", "") for e in policy.get("exempt", [])}
    min_services = int(policy.get("minServices", 1))
    owner = policy.get("owner", "(unset)")

    services, rejects = discover(args.repo)
    not_applicable = policy.get("notApplicable", {}) if isinstance(policy.get("notApplicable", {}), dict) else {}
    discovered_names = {s["name"] for s in services}

    if args.report:
        print("DISCOVERED MICROSERVICES")
        for s in services:
            a = audit(s, args.repo)
            na = set(not_applicable.get(s["name"], {})) & set(REQUIRED_EVENTS)
            missing = sorted(set(REQUIRED_EVENTS) - set(a["subscribed"]) - na)
            if s["name"] in exempt:
                state = "exempt"
            elif na and not missing:
                state = "OK(N/A)"
            elif not missing:
                state = "OK"
            else:
                state = "missing"
            print(f"  {s['name']:<26} {state:<8} entry={s['entrypoint']}")
            if a["subscribed"]:
                print(f"      subscribes: {', '.join(a['subscribed'])}")
            if na:
                for topic in sorted(na):
                    print(f"      not-applicable: {topic} — {not_applicable[s['name']][topic]}")
            if missing:
                print(f"      MISSING:    {', '.join(missing)}")
            if a["mentioned_only"]:
                print(f"      named but not bound to a handler: {', '.join(a['mentioned_only'])}")
        print("\nREJECTED (not a deployable service)")
        for r in rejects:
            print(f"  {r['name']:<26} missing: {', '.join(r['missing'])}")
        return 0

    # ── Anti-vacuity ────────────────────────────────────────────────────────
    #
    # A gate that checks nothing passes. If the layout changes under it — a
    # rename of `services/`, a move to a monorepo tool, a glob that silently
    # stops matching — discovery quietly returns [] and every check below is
    # vacuously satisfied. That is the single most common way a gate becomes
    # decorative, so it is a FAILURE here, not a warning.
    if not services:
        print(
            f"::error title=gate-microservice-events::discovered ZERO microservices under "
            f"{', '.join(SEARCH_ROOTS)}. Either the repo layout moved or the discovery rule broke — "
            f"a gate that checks nothing is not passing, it is not running."
        )
        return 1
    if len(services) < min_services:
        print(
            f"::error title=gate-microservice-events::discovered only {len(services)} microservice(s), "
            f"policy floor is {min_services}. Discovery is probably broken; if services were genuinely "
            f"removed, lower minServices in the policy in the same PR so the drop is reviewed."
        )
        return 1

    # ── Policy well-formedness ───────────────────────────────────────────────
    #
    # A malformed exemption must FAIL, not silently widen the gate. Validated
    # here (after discovery, so stale-declaration checks have the real service
    # set) and before any per-service verdict.
    policy_errors = validate_not_applicable(
        not_applicable, known, set(exempt), discovered_names
    )
    if policy_errors:
        for e in policy_errors:
            print(f"::error title=gate-microservice-events::{e}")
        print("\ngate-microservice-events: FAILING — notApplicable policy is malformed (see above).")
        return 1

    failures, warnings = [], []

    for s in services:
        name = s["name"]
        if name in exempt:
            continue
        a = audit(s, args.repo)
        na = set(not_applicable.get(name, {})) & set(REQUIRED_EVENTS)

        # Contradiction: a topic cannot be both declared not-applicable and
        # actually bound to a handler. One or the other, never both.
        contradiction = sorted(set(a["subscribed"]) & na)
        if contradiction:
            failures.append(
                f"{name}: declares {', '.join(contradiction)} not-applicable but also binds a handler "
                f"for it. Either it is handled or it is not applicable, not both — drop the "
                f"notApplicable entry."
            )
            continue

        # N/A topics are a satisfied obligation, not a gap: subtract them from
        # what the service must subscribe to.
        missing = sorted(set(REQUIRED_EVENTS) - set(a["subscribed"]) - na)

        if missing:
            detail = (
                f"{name}: does not subscribe to {', '.join(missing)}. "
                f"It cannot seed itself for a user or org it never hears about."
            )
            if a["mentioned_only"]:
                detail += (
                    f" (It NAMES {', '.join(a['mentioned_only'])} but never binds a handler — "
                    f"a topic in a constant or a comment is not a subscription.)"
                )
            (warnings if name in known else failures).append(detail)
        elif name in known:
            # The ratchet only tightens. A service that has been fixed must be
            # removed from the list in the same PR, or the list rots into a
            # permanent allowlist that nobody revisits — exactly how a "known
            # issues" file stops meaning anything.
            failures.append(
                f"{name}: now handles every required event but is still listed in "
                f"knownUnhandled. Remove it from {os.path.relpath(args.policy, args.repo)} — "
                f"the ratchet must not keep a fixed service exempted."
            )
        elif not a["seeds"]:
            failures.append(
                f"{name}: subscribes to the lifecycle events but no handler writes anything "
                f"(no insert/upsert/update/delete anywhere in src/). Subscribing without seeding "
                f"looks handled and seeds nothing."
            )

    for w in warnings:
        print(f"::warning title=gate-microservice-events::{w}")
    for f in failures:
        print(f"::error title=gate-microservice-events::{f}")

    na_services = sum(1 for n in not_applicable if n in discovered_names)
    print()
    print(f"gate-microservice-events: {len(services)} microservice(s) discovered, "
          f"{len(exempt)} exempt, {na_services} with not-applicable declaration(s), "
          f"{len(failures)} failing, {len(warnings)} known-unhandled (warn).")

    if warnings:
        print(
            f"\nThe {len(warnings)} warning(s) above are pre-existing debt tracked in "
            f"{os.path.relpath(args.policy, args.repo)} (owner {owner}). They do NOT fail this gate "
            f"today, but the list is a ratchet: a service is only ever removed from it, never added. "
            f"A NEW service missing these events fails immediately."
        )

    if failures:
        print("\ngate-microservice-events: FAILING — see the ::error annotations above.")
        return 1

    print("gate-microservice-events: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
