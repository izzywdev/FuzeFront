import importlib.util
import json
import os
import pathlib
import subprocess
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).resolve().parents[1] / "codex_subscription_review.py"
spec = importlib.util.spec_from_file_location("review", PATH)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
AUTH = json.dumps({"tokens": {"access_token": "fake-access", "refresh_token": "fake-refresh", "id_token": "fake-id"}})


class SubscriptionReviewTest(unittest.TestCase):
    def test_success_isolated_and_cleanup(self):
        roots = []
        def run(args, **kwargs):
            roots.append(pathlib.Path(kwargs["cwd"]).parent)
            self.assertEqual(kwargs["input"], "review this diff")
            self.assertIs(kwargs["check"], False)
            self.assertIn("read-only", args)
            self.assertIn("shell_tool", args)
            self.assertNotIn("danger-full-access", args)
            self.assertNotIn("GH_TOKEN", kwargs["env"])
            self.assertNotIn("OPENAI_API_KEY", kwargs["env"])
            self.assertNotIn("FUZE_CODEX_AUTH_JSON", kwargs["env"])
            self.assertFalse(list(pathlib.Path(kwargs["cwd"]).iterdir()))
            auth = pathlib.Path(kwargs["env"]["CODEX_HOME"]) / "auth.json"
            self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
            self.assertIn('forced_login_method = "chatgpt"', auth.with_name("config.toml").read_text())
            pathlib.Path(args[args.index("--output-last-message") + 1]).write_text("VERDICT: APPROVE")
            return subprocess.CompletedProcess(args, 0)
        with patch.dict(os.environ, {"GH_TOKEN": "must-not-inherit", "OPENAI_API_KEY": "must-not-inherit"}), patch.object(review.subprocess, "run", run):
            self.assertEqual(review.review(AUTH, "review this diff"), "VERDICT: APPROVE")
        self.assertFalse(roots[0].exists())

    def test_reject_api_auth_missing_tokens_and_empty_prompt(self):
        for auth, prompt in [("{}", "review"), ('{"OPENAI_API_KEY":"fake"}', "review"), (AUTH, "")]:
            with self.assertRaises(ValueError), patch.object(review.subprocess, "run") as run:
                review.review(auth, prompt)
            run.assert_not_called()

    def test_failure_empty_output_and_timeout_fail_closed(self):
        for result in [subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)]:
            with patch.object(review.subprocess, "run", return_value=result), self.assertRaises(RuntimeError):
                review.review(AUTH, "review")
        with patch.object(review.subprocess, "run", side_effect=subprocess.TimeoutExpired("codex", 600)), self.assertRaises(subprocess.TimeoutExpired):
            review.review(AUTH, "review")

    def test_action_prevents_paid_retry_after_subscription(self):
        import yaml
        action = yaml.safe_load(PATH.with_name("action.yml").read_text())
        steps = {s.get("id", s["name"]): s for s in action["runs"]["steps"]}
        for name in ("codex", "gemini"):
            self.assertIn("inputs.codex-auth-json == ''", steps[name]["if"])
        self.assertIn("inputs.task-prompt != ''", steps["codex-subscription"]["if"])
        self.assertEqual(steps["codex-subscription"]["env"]["FUZE_CODEX_AUTH_JSON"], "${{ inputs.codex-auth-json }}")


if __name__ == "__main__":
    unittest.main()
