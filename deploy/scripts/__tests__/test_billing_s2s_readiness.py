import http.server
import os
import pathlib
import re
import subprocess
import threading
import unittest

TEMPLATE = pathlib.Path(__file__).parents[2] / "helm/fuzefront/templates/billing-s2s-register-job.yaml"
SCRIPT = re.search(r"node <<'NODE'\n(.*?)\n\s+NODE", TEMPLATE.read_text(), re.DOTALL).group(1)
SCRIPT = "\n".join(line[14:] for line in SCRIPT.splitlines())

class ReadinessTests(unittest.TestCase):
    def run_probe(self, statuses):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                self.send_response(statuses[min(len(requests) - 1, len(statuses) - 1)])
                self.end_headers()
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            env = {**os.environ, "AUTHENTIK_BASE_URL": f"http://127.0.0.1:{server.server_port}", "AUTHENTIK_READY_TIMEOUT_MS": "5000"}
            result = subprocess.run(["node", "-e", SCRIPT], env=env, text=True, capture_output=True, timeout=10, check=False)
        finally:
            server.shutdown()
            server.server_close()
        return result, requests
    def test_waits_for_ready_endpoint_without_credentials(self):
        result, requests = self.run_probe([503, 503, 200])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(requests, [("/-/health/ready/", None)] * 3)
        self.assertIn("readiness confirmed", result.stdout)
    def test_permanent_failure_stops_before_registration(self):
        result, requests = self.run_probe([503])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("registration was not attempted", result.stderr)
        self.assertGreater(len(requests), 0)
        self.assertTrue(all(auth is None for _, auth in requests))

    def test_connection_refused_is_bounded(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)
        port = server.server_port
        server.server_close()
        env = {**os.environ, "AUTHENTIK_BASE_URL": f"http://127.0.0.1:{port}", "AUTHENTIK_READY_TIMEOUT_MS": "2000"}
        result = subprocess.run(["node", "-e", SCRIPT], env=env, text=True, capture_output=True, timeout=6, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("registration was not attempted", result.stderr)
        self.assertNotIn("readiness confirmed", result.stdout)

if __name__ == "__main__":
    unittest.main()
