import datetime as dt
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from scripts import agentic_threat_intel as intel
from scripts.agentic_threat_intel import clean_text, record, safe_url, validate


class AgenticThreatIntelTests(unittest.TestCase):
    def test_untrusted_title_is_flattened_and_markdown_neutralized(self):
        self.assertEqual(clean_text("[ignore]\n`system`\x00"), "(ignore) 'system'")

    def test_only_https_links_are_reportable(self):
        self.assertEqual(safe_url("javascript:alert(1)"), "")
        self.assertEqual(safe_url("http://example.com"), "")
        self.assertEqual(safe_url("https://example.com/item"), "https://example.com/item")

    def test_remote_record_does_not_store_body(self):
        item = record("feed", "ID-1", "A title", "2026-01-01", "https://example.com/ID-1")
        self.assertEqual(set(item), {"id", "source", "title", "published", "url"})

    def test_repository_register_is_valid(self):
        validate()

    def test_github_advisories_are_paginated_until_the_since_boundary(self):
        since = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)

        def advisory(identifier, updated, summary):
            return {
                "ghsa_id": identifier,
                "updated_at": updated,
                "published_at": updated,
                "summary": summary,
                "html_url": f"https://github.com/advisories/{identifier}",
            }

        first_page = [advisory(f"GHSA-{index}", "2026-10-07T00:00:00Z", "routine update")
                      for index in range(100)]
        second_page = [
            advisory("GHSA-NEW", "2026-10-06T00:00:00Z", "agentic prompt injection"),
            advisory("GHSA-OLD", "2026-09-30T00:00:00Z", "agentic prompt injection"),
        ]
        with patch.object(intel, "request_json", side_effect=[first_page, second_page]) as request:
            results = intel.fetch_github({"id": "github", "url": "https://api.github.com/advisories"}, since)

        self.assertEqual([item["id"] for item in results], ["github:GHSA-NEW"])
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[1].args[1]["page"], "2")

    def test_partial_feed_failure_persists_records_without_advancing_cursor(self):
        original_cursor = "2026-10-07T00:00:00Z"
        new_record = record("nvd", "CVE-2026-1234", "prompt injection", original_cursor,
                            "https://example.com/CVE-2026-1234")
        count = self._collect(
            {"last_successful_run": original_cursor, "seen_ids": []},
            {"nvd": lambda _source, _since: [new_record],
             "github": lambda _source, _since: (_ for _ in ()).throw(urllib.error.URLError("offline"))},
        )

        state = json.loads((self.data_dir / "state.json").read_text(encoding="utf-8"))
        discoveries = json.loads((self.data_dir / "discoveries.json").read_text(encoding="utf-8"))
        self.assertEqual(count, 1)
        self.assertEqual(state["last_successful_run"], original_cursor)
        self.assertEqual(state["seen_ids"], [new_record["id"]])
        self.assertEqual([item["id"] for item in discoveries["records"]], [new_record["id"]])

    def test_successful_no_delta_run_advances_cursor(self):
        original_cursor = "2026-10-07T00:00:00Z"
        count = self._collect(
            {"last_successful_run": original_cursor, "seen_ids": []},
            {"nvd": lambda _source, _since: [], "github": lambda _source, _since: []},
        )

        state = json.loads((self.data_dir / "state.json").read_text(encoding="utf-8"))
        self.assertEqual(count, 0)
        self.assertNotEqual(state["last_successful_run"], original_cursor)

    def test_http_warning_includes_status_without_error_body(self):
        count = self._collect(
            {"last_successful_run": "2026-10-07T00:00:00Z", "seen_ids": []},
            {"nvd": lambda _source, _since: (_ for _ in ()).throw(
                urllib.error.HTTPError("https://api.example.com", 429, "private response", {}, None)
            ),
             "github": lambda _source, _since: []},
        )

        report = (self.data_dir / "report.md").read_text(encoding="utf-8")
        self.assertEqual(count, 0)
        self.assertIn("nvd: HTTP 429", report)
        self.assertNotIn("private response", report)

    def _collect(self, state, fetchers):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "state.json").write_text(json.dumps(state), encoding="utf-8")
        (self.data_dir / "sources.json").write_text(
            json.dumps({"sources": [{"id": kind, "kind": kind} for kind in fetchers]}),
            encoding="utf-8",
        )
        with patch.object(intel, "DATA", self.data_dir), patch.object(intel, "validate"), \
                patch.dict(intel.FETCHERS, fetchers):
            return intel.collect(self.data_dir / "report.md", 7)


if __name__ == "__main__":
    unittest.main()
