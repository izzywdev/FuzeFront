"""Regression contract for watchable FuzeQuality production evidence."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "post-prod-e2e.yml"


class FuzeQualityPostProdEvidenceTest(unittest.TestCase):
    def test_video_artifact_is_specific_and_deterministic(self):
        workflow = WORKFLOW.read_text()

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


if __name__ == "__main__":
    unittest.main()
