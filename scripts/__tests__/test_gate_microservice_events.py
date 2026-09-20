"""Tests for scripts/gate_microservice_events.py.

"Passes against a clean tree" is not evidence a gate works; "fails against a
fixture built to break it" is. Every test here constructs a throwaway repo on
disk, so the gate is exercised end to end through main() and its real exit code
— not through a mocked internal.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "scripts", "gate_microservice_events.py")

ALL_FOUR = [
    "identity.user.created",
    "identity.user.deleted",
    "identity.org.created",
    "identity.org.deleted",
]


def make_service(root: str, parent: str, name: str, *, topics=(), effect=True, service=True):
    """Create a directory that is (or deliberately is not) a microservice."""
    d = os.path.join(root, parent, name)
    os.makedirs(os.path.join(d, "src"), exist_ok=True)
    if service:
        with open(os.path.join(d, "package.json"), "w") as fh:
            json.dump({"name": name}, fh)
        with open(os.path.join(d, "Dockerfile"), "w") as fh:
            fh.write("FROM node:24-alpine\n")
    body = ["import { TypedConsumer } from '@fuzefront/shared/kafka'", "export async function start() {"]
    for t in topics:
        body.append(f"  await consumer.subscribe('{t}', handler)")
    if effect:
        body.append("  await db('seed_table').insert({ id: 1 })")
    body.append("}")
    with open(os.path.join(d, "src", "index.ts"), "w") as fh:
        fh.write("\n".join(body))
    return d


def make_identity_pkg(root: str):
    """The real alias definition site, so REF_INDEX_TOPICS resolves."""
    d = os.path.join(root, "packages", "identity", "src")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "ref-index.ts"), "w") as fh:
        fh.write(
            textwrap.dedent(
                """
                export const TOPIC_PROJECTIONS = Object.freeze({
                  'identity.user.created': { entityType: 'user' },
                  'identity.user.deleted': { entityType: 'user' },
                  'identity.org.created': { entityType: 'organization' },
                  'identity.org.deleted': { entityType: 'organization' },
                })
                export const REF_INDEX_TOPICS = Object.freeze(Object.keys(TOPIC_PROJECTIONS))
                """
            )
        )


def write_policy(root: str, **over):
    policy = {"owner": "@test", "minServices": 1, "knownUnhandled": [], "exempt": []}
    policy.update(over)
    os.makedirs(os.path.join(root, "governance"), exist_ok=True)
    p = os.path.join(root, "governance", "microservice-events-policy.json")
    with open(p, "w") as fh:
        json.dump(policy, fh)
    return p


def run_gate(root: str, policy: str, *extra):
    return subprocess.run(
        [sys.executable, GATE, "--repo", root, "--policy", policy, *extra],
        capture_output=True,
        text=True,
        check=False,
    )


class GateMicroserviceEvents(unittest.TestCase):
    def test_new_service_missing_events_FAILS(self):
        """The whole point: debt cannot grow. A service not on the ratchet fails."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "brand-new-service", topics=[])
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("brand-new-service", r.stdout)
            self.assertIn("::error", r.stdout)

    def test_ratcheted_service_missing_events_only_WARNS(self):
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "legacy-service", topics=[])
            r = run_gate(root, write_policy(root, knownUnhandled=["legacy-service"]))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("::warning", r.stdout)
            self.assertNotIn("::error", r.stdout)

    def test_ratchet_must_tighten_when_a_listed_service_is_fixed(self):
        """A fixed service left on the list turns it into a permanent allowlist."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "legacy-service", topics=ALL_FOUR)
            r = run_gate(root, write_policy(root, knownUnhandled=["legacy-service"]))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("Remove it from", r.stdout)

    def test_subscribing_without_any_effect_FAILS(self):
        """A handler that logs and returns looks handled and seeds nothing."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "noop-service", topics=ALL_FOUR, effect=False)
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("no handler writes anything", r.stdout)

    def test_outbound_mutating_http_counts_as_seeding(self):
        """provisioning-service owns no table; it POSTs. That is still seeding."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            d = make_service(root, "services", "stateless-service", topics=ALL_FOUR, effect=False)
            with open(os.path.join(d, "src", "provision.ts"), "w") as fh:
                fh.write("await http.fetch(url, { method: 'POST', body })\n")
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_topic_set_alias_resolves(self):
        """`for (const t of REF_INDEX_TOPICS) subscribe(t)` counts as all four."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            d = make_service(root, "services", "alias-service", topics=[])
            with open(os.path.join(d, "src", "index.ts"), "w") as fh:
                fh.write(
                    "import { REF_INDEX_TOPICS } from '@izzywdev/fuzefront-identity'\n"
                    "for (const t of REF_INDEX_TOPICS) { await consumer.subscribe(t, h) }\n"
                    "await db('x').insert({})\n"
                )
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_unresolvable_alias_is_an_error_not_an_empty_set(self):
        """If the alias cannot expand, every user of it would look unsubscribed."""
        with tempfile.TemporaryDirectory() as root:
            # No packages/identity — the alias definition site is missing.
            d = make_service(root, "services", "alias-service", topics=[])
            with open(os.path.join(d, "src", "index.ts"), "w") as fh:
                fh.write("for (const t of REF_INDEX_TOPICS) { await consumer.subscribe(t, h) }\n")
            r = run_gate(root, write_policy(root))
            self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_ANTI_VACUITY_zero_services_discovered_FAILS(self):
        """A gate that checks nothing is not passing — it is not running."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("ZERO microservices", r.stdout)

    def test_minServices_floor_FAILS(self):
        """Discovery silently narrowing is caught by the floor, not celebrated."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "only-one", topics=ALL_FOUR)
            r = run_gate(root, write_policy(root, minServices=5))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("policy floor", r.stdout)

    def test_non_service_directories_are_rejected(self):
        """A library or a spec dir must not be enrolled and then fail."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            make_service(root, "services", "real-one", topics=ALL_FOUR)
            make_service(root, "services", "just-a-lib", topics=[], service=False)
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertNotIn("just-a-lib", r.stdout)

    def test_topic_named_but_not_bound_is_not_a_subscription(self):
        """A constant or a comment mentioning a topic is not handling it."""
        with tempfile.TemporaryDirectory() as root:
            make_identity_pkg(root)
            d = make_service(root, "services", "mentions-only", topics=[])
            with open(os.path.join(d, "src", "index.ts"), "w") as fh:
                fh.write(
                    "// TODO: one day handle identity.user.created\n"
                    "const T = 'identity.org.created'\n"
                    "await db('x').insert({})\n"
                )
            r = run_gate(root, write_policy(root))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("mentions-only", r.stdout)

    def test_ANTI_VACUITY_real_repo_passes(self):
        """The committed tree + committed policy must be green, or the ratchet is wrong."""
        r = run_gate(
            REPO_ROOT,
            os.path.join(REPO_ROOT, "governance", "microservice-events-policy.json"),
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("gate-microservice-events: OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
