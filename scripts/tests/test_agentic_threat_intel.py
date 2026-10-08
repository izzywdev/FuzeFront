import unittest

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


if __name__ == "__main__":
    unittest.main()
