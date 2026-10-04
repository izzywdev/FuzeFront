import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location(
    "connector_dependency", Path(__file__).resolve().parents[1] / "check-connector-dependency.py"
)
dependency = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dependency)


class ConnectorDependencyTest(unittest.TestCase):
    def response(self, data, status=200):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = status
        response.read.return_value = data if isinstance(data, bytes) else json.dumps(data).encode()
        return response

    def test_deployed_healthy_protocol_passes_exact_production_probe(self):
        with patch.object(dependency.urllib.request, "urlopen", return_value=self.response({
            "status": "healthy", "database": "connected (PostgreSQL)", "connector_credential_protocol": "google-shared-v1",
        })) as probe:
            dependency.check_dependency()
            request = probe.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.keys.prod.fuzefront.com/health")
            self.assertEqual(probe.call_args.kwargs["timeout"], 10)
            self.assertEqual(request.get_header("Cache-control"), "no-cache")

    def test_missing_wrong_protocol_or_unhealthy_service_fails(self):
        for body in (
            {"status": "healthy", "database": "connected (PostgreSQL)"},
            {"status": "healthy", "database": "connected (PostgreSQL)", "connector_credential_protocol": "legacy"},
            {"status": "degraded", "connector_credential_protocol": "google-shared-v1"},
            {"status": "healthy", "database": "disconnected", "connector_credential_protocol": "google-shared-v1"},
            [],
        ):
            with self.subTest(body=body), patch.object(dependency.urllib.request, "urlopen", return_value=self.response(body)):
                with self.assertRaises(ValueError):
                    dependency.check_dependency()

    def test_malformed_oversized_and_non_200_responses_fail(self):
        for response in (self.response(b"not JSON"), self.response(b"x" * 65537), self.response({}, 503)):
            with patch.object(dependency.urllib.request, "urlopen", return_value=response):
                with self.assertRaises(ValueError):
                    dependency.check_dependency()

    def test_unavailable_dependency_returns_failure_without_reflecting_details(self):
        with patch.object(dependency.urllib.request, "urlopen", side_effect=URLError("private upstream details")), patch("sys.stderr", new_callable=io.StringIO) as error:
            self.assertEqual(dependency.main(), 1)
            self.assertNotIn("private upstream details", error.getvalue())
            self.assertIn("Deploy and verify FuzeKeys first", error.getvalue())


if __name__ == "__main__":
    unittest.main()
