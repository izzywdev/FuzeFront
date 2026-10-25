"""Tests for scripts/gate_telemetry_parity.py.

Assert the gate FAILS on each class of Node<->Python drift, not only that it
passes on a matching tree — a gate is worth its runtime only if it is known to
fire. Builds a minimal synthetic repo (the two Node source files, the Python
contract module, and the two redaction JSONs) and mutates one fact at a time.

Run: python -m unittest discover -s scripts/__tests__ -p 'test_*.py'
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
GATE = os.path.join(REPO_ROOT, "scripts", "gate_telemetry_parity.py")

CONFIG_TS = """
const protocol = env.OTEL_EXPORTER_OTLP_PROTOCOL;
const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
const ratio = env.OTEL_TRACES_SAMPLER_ARG; // not OTEL_TRACES_SAMPLER (a comment)
const headers = env.OTEL_EXPORTER_OTLP_HEADERS;
"""

LOGGING_TS = """
return logger.child({ trace_id: req.traceId, span_id: req.spanId });
"""

CONTRACT_PY = '''
from types import MappingProxyType
OTEL_ENV_VARS: tuple[str, ...] = (
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_TRACES_SAMPLER_ARG",
    "OTEL_EXPORTER_OTLP_HEADERS",
)
TRACE_ID_FIELD: str = "trace_id"
SPAN_ID_FIELD: str = "span_id"
REQUEST_ID_FIELD: str = "reqId"
LOG_LEVELS: MappingProxyType[str, int] = MappingProxyType(
    {"trace": 10, "debug": 20, "info": 30, "warn": 40, "error": 50, "fatal": 60}
)
'''

REDACTION = {"version": 1, "paths": ["password", "token", "authorization"]}


def build_tree(root: str, *, contract_py: str = CONTRACT_PY, bundled=REDACTION) -> None:
    os.makedirs(os.path.join(root, "packages/telemetry/src"), exist_ok=True)
    os.makedirs(os.path.join(root, "packages/telemetry-py/fuzefront_telemetry"), exist_ok=True)
    os.makedirs(os.path.join(root, "governance"), exist_ok=True)
    with open(os.path.join(root, "packages/telemetry/src/config.ts"), "w") as f:
        f.write(CONFIG_TS)
    with open(os.path.join(root, "packages/telemetry/src/logging.ts"), "w") as f:
        f.write(LOGGING_TS)
    with open(os.path.join(root, "packages/telemetry-py/fuzefront_telemetry/contract.py"), "w") as f:
        f.write(textwrap.dedent(contract_py))
    with open(os.path.join(root, "governance/observability-redaction-paths.json"), "w") as f:
        json.dump(REDACTION, f)
    with open(os.path.join(root, "packages/telemetry-py/fuzefront_telemetry/redaction_paths.json"), "w") as f:
        json.dump(bundled, f)


def run_gate(root: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, GATE, root],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


class TelemetryParityGateTest(unittest.TestCase):
    def test_passes_on_matching_tree(self):
        with tempfile.TemporaryDirectory() as root:
            build_tree(root)
            result = run_gate(root)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_passes_when_neither_package_present(self):
        with tempfile.TemporaryDirectory() as root:
            result = run_gate(root)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_fails_on_env_var_drift(self):
        contract = CONTRACT_PY.replace("OTEL_TRACES_SAMPLER_ARG", "OTEL_TRACES_SAMPLER_RATE")
        with tempfile.TemporaryDirectory() as root:
            build_tree(root, contract_py=contract)
            result = run_gate(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("env var", result.stderr)

    def test_fails_on_trace_field_drift(self):
        contract = CONTRACT_PY.replace('SPAN_ID_FIELD: str = "span_id"', 'SPAN_ID_FIELD: str = "spanId"')
        with tempfile.TemporaryDirectory() as root:
            build_tree(root, contract_py=contract)
            result = run_gate(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("trace log field", result.stderr)

    def test_fails_on_request_id_drift(self):
        contract = CONTRACT_PY.replace('REQUEST_ID_FIELD: str = "reqId"', 'REQUEST_ID_FIELD: str = "request_id"')
        with tempfile.TemporaryDirectory() as root:
            build_tree(root, contract_py=contract)
            result = run_gate(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("REQUEST_ID_FIELD", result.stderr)

    def test_fails_on_level_number_drift(self):
        contract = CONTRACT_PY.replace('"warn": 40', '"warn": 35')
        with tempfile.TemporaryDirectory() as root:
            build_tree(root, contract_py=contract)
            result = run_gate(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("log level", result.stderr)

    def test_fails_on_redaction_drift(self):
        with tempfile.TemporaryDirectory() as root:
            build_tree(root, bundled={"version": 1, "paths": ["password", "token"]})
            result = run_gate(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("redaction", result.stderr)


if __name__ == "__main__":
    unittest.main()
