"""Regression contract for watchable FuzeQuality production evidence."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "post-prod-e2e.yml"


class FuzeQualityPostProdEvidenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text()

    def step(self, name: str) -> str:
        match = re.search(
            rf"      - name: {re.escape(name)}\n(?P<body>.*?)(?=\n      - name:|\Z)",
            self.workflow,
            re.DOTALL,
        )
        self.assertIsNotNone(match, f"workflow step not found: {name}")
        return match.group("body")

    def test_video_artifact_is_specific_and_deterministic(self):
        workflow = self.workflow

        self.assertIn("-path '*fuzequality-portal-smoke*'", workflow)
        self.assertIn(
            "frontend/post-prod-evidence/fuzequality-portal-smoke.webm",
            workflow,
        )
        self.assertIn("name: fuzequality-post-prod-playwright-video", workflow)
        self.assertIn("if-no-files-found: error", workflow)
        self.assertNotIn(
            "path: frontend/test-results-post-prod/**/video.webm",
            workflow,
        )

    def test_connector_only_run_skips_fuzequality_evidence_steps(self):
        condition = "if: ${{ always() && !inputs.connectors_only }}"

        self.assertIn(condition, self.step("Stage FuzeQuality production video"))
        self.assertIn(condition, self.step("Upload FuzeQuality post-production video"))

    def test_full_run_still_fails_when_fuzequality_video_is_missing(self):
        stage = self.step("Stage FuzeQuality production video")
        upload = self.step("Upload FuzeQuality post-production video")

        self.assertIn("if (( ${#videos[@]} == 0 )); then", stage)
        self.assertIn("exit 1", stage)
        self.assertIn("if-no-files-found: error", upload)


if __name__ == "__main__":
    unittest.main()
