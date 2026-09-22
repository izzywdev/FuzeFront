"""Tests for gate-devportal-spec-registration.

Same governing principle as the other gates in this family: assert the gate
FIRES on the two ways a spec never reaches the catalog, not merely that it
passes on an already-consistent tree. Passing is not evidence.

  R1  a service with its own HTTP server and no openapi.yaml
  R2  an openapi.yaml collect-devportal-specs.mjs's SOURCES never mentions

plus the two ways each of those is legitimately NOT a finding (exemption,
registration), and the no-collector no-op.
"""
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(os.path.dirname(__file__))))
GATE = os.path.join(REPO, "scripts", "gate_devportal_spec_registration.py")

APP_LISTEN = """\
import express from 'express';
const app = express();
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.listen(3000);
"""

COLLECTOR = """\
const SOURCES = [
  { service: 'billing-service', specPath: 'services/billing-service/openapi.yaml' },
];
"""


def make_repo(files):
    d = tempfile.mkdtemp()
    for rel, body in files.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(body)
    for cmd in (["git", "init", "-q", "."],
                ["git", "config", "user.email", "t@t"],
                ["git", "config", "user.name", "t"],
                ["git", "add", "-A"],
                ["git", "commit", "-qm", "x"]):
        subprocess.run(cmd, cwd=d, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return d


def run(repo):
    r = subprocess.run([sys.executable, GATE, repo],
                       capture_output=True, text=True, check=False)
    return r.returncode, r.stdout + r.stderr


class NoCollectorIsANoop(unittest.TestCase):
    def test_no_collector_file_means_nothing_to_check(self):
        repo = make_repo({
            "services/widget-service/package.json": "{}",
            "services/widget-service/src/index.ts": APP_LISTEN,
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)
        self.assertIn("nothing to check", out)


class R1FiresOnAnUndocumentedServer(unittest.TestCase):
    def test_service_with_own_http_server_and_no_spec_fires(self):
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/widget-service/package.json": "{}",
            "services/widget-service/src/index.ts": APP_LISTEN,
        })
        code, out = run(repo)
        self.assertEqual(code, 1, out)
        self.assertIn("D1", out)
        self.assertIn("services/widget-service/", out)

    def test_a_contract_only_directory_with_no_package_json_is_not_flagged(self):
        # app-registry-service / portal-service / custom-hostname-api shape:
        # the openapi.yaml lives here but the service itself runs elsewhere.
        # Registered in SOURCES so only R1 (not R2) is under test here.
        collector = COLLECTOR.replace(
            "];",
            "  { service: 'contract-only', specPath: 'services/contract-only/openapi.yaml' },\n];")
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": collector,
            "services/contract-only/openapi.yaml": "openapi: 3.0.3\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)

    def test_a_service_with_no_listen_call_is_not_flagged(self):
        # A worker/consumer directory that happens to ship a package.json but
        # never starts its own HTTP server is not this gate's business.
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/worker-only/package.json": "{}",
            "services/worker-only/src/index.ts": "console.log('consuming kafka');\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)


class R1ExemptionSuppressesTheFinding(unittest.TestCase):
    def test_declared_exemption_with_a_reason_is_honored(self):
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/widget-service/package.json": "{}",
            "services/widget-service/src/index.ts": APP_LISTEN,
            "governance/devportal-spec-exempt.txt":
                "widget-service  # pure Kafka consumer, health probe only\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)

    def test_a_bare_name_with_no_reason_does_not_count_as_exempt(self):
        # A one-line "why" is the whole point of the file; a name alone must
        # not silently suppress a real gap.
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/widget-service/package.json": "{}",
            "services/widget-service/src/index.ts": APP_LISTEN,
            "governance/devportal-spec-exempt.txt": "widget-service\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 1, out)
        self.assertIn("D1", out)


class R1IsSatisfiedByAnOwnSpec(unittest.TestCase):
    def test_a_service_with_its_own_openapi_yaml_is_not_flagged(self):
        # Registered in SOURCES so only R1 (not R2) is under test here.
        collector = COLLECTOR.replace(
            "];",
            "  { service: 'widget-service', specPath: 'services/widget-service/openapi.yaml' },\n];")
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": collector,
            "services/widget-service/package.json": "{}",
            "services/widget-service/src/index.ts": APP_LISTEN,
            "services/widget-service/openapi.yaml": "openapi: 3.0.3\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)


class R2FiresOnAnUnregisteredSpec(unittest.TestCase):
    def test_a_spec_on_disk_the_collector_never_mentions_fires(self):
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/orphan-service/openapi.yaml": "openapi: 3.0.3\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 1, out)
        self.assertIn("D2", out)
        self.assertIn("services/orphan-service/openapi.yaml", out)

    def test_a_registered_spec_is_not_flagged(self):
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": COLLECTOR,
            "services/billing-service/openapi.yaml": "openapi: 3.0.3\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)

    def test_a_registered_package_spec_is_not_flagged(self):
        collector = COLLECTOR.replace(
            "];",
            "  { service: 'auth', specPath: 'packages/auth/openapi.yaml' },\n];")
        repo = make_repo({
            "scripts/collect-devportal-specs.mjs": collector,
            "packages/auth/openapi.yaml": "openapi: 3.0.3\n",
        })
        code, out = run(repo)
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main()
