"""Pin the Codex subscription reviewer toolchain on minimal self-hosted runners."""

import unittest
from pathlib import Path

import yaml

ACTION = Path(__file__).resolve().parents[1] / "action.yml"


class TestCodexSubscriptionToolchain(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.steps = yaml.safe_load(ACTION.read_text(encoding="utf-8"))["runs"]["steps"]

    def test_node_is_pinned_and_installed_before_codex_cli(self):
        names = [step.get("name") for step in self.steps]
        node_i = names.index("Install pinned Node.js for Codex subscription reviewer")
        cli_i = names.index("Install pinned Codex subscription reviewer")
        review_i = names.index("Codex subscription review")
        self.assertLess(node_i, cli_i)
        self.assertLess(cli_i, review_i)

        node = self.steps[node_i]
        self.assertEqual(
            node["uses"],
            "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        )
        self.assertEqual(str(node["with"]["node-version"]), "24")
        self.assertEqual(str(node["with"]["package-manager-cache"]).lower(), "false")

    def test_toolchain_and_review_share_the_failover_gate(self):
        by_name = {step.get("name"): step for step in self.steps}
        expected = by_name["Codex subscription review"]["if"]
        self.assertEqual(
            by_name["Install pinned Node.js for Codex subscription reviewer"]["if"],
            expected,
        )
        self.assertEqual(
            by_name["Install pinned Codex subscription reviewer"]["if"],
            expected,
        )
        self.assertIn("inputs.codex-auth-json != ''", expected)
        self.assertIn("inputs.task-prompt != ''", expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
