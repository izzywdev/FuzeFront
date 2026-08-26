#!/usr/bin/env python3
"""An empty `with:` value OVERRIDES the callee's default — it does not fall back.

This is the defect this file exists to prevent, and it shipped: fuze-code-action
declared `codex-safety-strategy` with `default: ''` and forwarded it as
codex-action's `safety-strategy`. codex-action declares that input with
`default: 'drop-sudo'`, but a caller-supplied empty string wins, and its
`resolve-codex-home` step then aborted with `Invalid safety strategy: .` — so
rung 2 died before running on EVERY invocation. The chain reported itself
exhausted and the action failed, for months, without ever once executing the
fallover it exists to provide.

The rule, asserted below: for every input this action forwards to a third-party
action, if the CALLEE declares a non-empty default, then either this action's
own default is non-empty, or the forwarding step's `if:` proves the value cannot
be empty when the step runs.

The callee tables are recorded from the exact pinned SHAs. They are offline on
purpose — CI must not need network to check this — which means a pin bump
invalidates them. `test_every_third_party_pin_is_recorded` fails on an
unrecorded `uses:`, so bumping a pin forces re-reading that action's inputs
rather than silently carrying a stale table forward.

Run: python3 .github/actions/fuze-code-action/__tests__/test_passthrough_defaults.py
"""
import os
import re
import sys
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover - reported, never silently skipped
    print("SKIP-BLOCKED: PyYAML is not installed, so the passthrough defaults were NOT checked.")
    print("This is a gap, not a pass. Install PyYAML in this job.")
    sys.exit(1)

ACTION = os.path.join(os.path.dirname(__file__), os.pardir, "action.yml")

# Non-empty `default:` values declared by each pinned callee, read from its own
# action.yml at that SHA. Only non-empty defaults are listed: an input whose
# callee default is already empty cannot be harmed by forwarding an empty value.
CALLEE_DEFAULTS = {
    "anthropics/claude-code-action@428971d2ecd6e3a7cb0ee0da2a3a8b33fdb3678d": {
        "trigger_phrase": "@claude",
        "label_trigger": "claude",
        "branch_prefix": "claude/",
        "use_bedrock": "false",
        "use_vertex": "false",
        "use_foundry": "false",
        "use_sticky_comment": "false",
        "classify_inline_comments": "true",
        "use_commit_signing": "false",
        "bot_id": "41898282",
        "bot_name": "claude[bot]",
        "track_progress": "false",
        "include_fix_links": "true",
        "display_report": "false",
        "show_full_output": "false",
    },
    "openai/codex-action@52fe01ec70a42f454c9d2ebd47598f9fd6893d56": {
        "safety-strategy": "drop-sudo",
        "allow-bots": "false",
    },
    "google-github-actions/run-gemini-cli@f77273f4c914e4bf38440cf36a0369cb64a37489": {
        "gcp_token_format": "access_token",
        "gcp_access_token_scopes": (
            "https://www.googleapis.com/auth/cloud-platform,"
            "https://www.googleapis.com/auth/userinfo.email,"
            "https://www.googleapis.com/auth/userinfo.profile"
        ),
        "gemini_cli_version": "latest",
        "prompt": "You are a helpful assistant.",
        "use_gemini_code_assist": "false",
        "use_vertex_ai": "false",
        "upload_artifacts": "false",
        "use_pnpm": "false",
        "workflow_name": "${{ github.workflow }}",
        "github_pr_number": "${{ github.event.pull_request.number }}",
        "github_issue_number": "${{ github.event.issue.number }}",
    },
}

# `${{ inputs.x }}` and nothing else — a composed expression is not a bare
# passthrough and is out of scope for this check.
BARE_PASSTHROUGH = re.compile(r"^\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}$")


def _uses_key(uses):
    return uses.split("#", 1)[0].strip()


class TestPassthroughDefaults(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(ACTION, encoding="utf-8") as fh:
            cls.doc = yaml.safe_load(fh)
        cls.inputs = cls.doc["inputs"]
        cls.steps = cls.doc["runs"]["steps"]

    def test_every_third_party_pin_is_recorded(self):
        for step in self.steps:
            uses = step.get("uses")
            if not uses or uses.startswith("./"):
                continue
            self.assertIn(
                _uses_key(uses),
                CALLEE_DEFAULTS,
                f"{uses} is not in CALLEE_DEFAULTS. If this is a pin bump, re-read that "
                f"action's action.yml at the NEW sha and update the table — carrying the "
                f"old one forward would check the wrong defaults.",
            )

    def test_no_empty_passthrough_over_a_nonempty_callee_default(self):
        checked = 0
        for step in self.steps:
            uses = step.get("uses")
            if not uses or uses.startswith("./"):
                continue
            callee = CALLEE_DEFAULTS[_uses_key(uses)]
            guard = re.sub(r"\s+", " ", step.get("if") or "")
            for key, value in (step.get("with") or {}).items():
                m = BARE_PASSTHROUGH.match(str(value).strip())
                if not m or key not in callee:
                    continue
                checked += 1
                name = m.group(1)
                self.assertIn(name, self.inputs, f"{uses} `{key}` forwards undeclared input {name}")
                own_default = str(self.inputs[name].get("default", ""))
                gated = f"inputs.{name} != ''" in guard
                self.assertTrue(
                    own_default != "" or gated,
                    f"{uses} input `{key}` has callee default {callee[key]!r}, but this action "
                    f"forwards `inputs.{name}` whose own default is EMPTY and whose step is not "
                    f"gated on `inputs.{name} != ''`. An empty `with:` value overrides the callee "
                    f"default rather than falling back to it.",
                )
        # Guards against the check silently covering nothing if the `with:`
        # blocks are ever restructured.
        self.assertGreater(checked, 0, "no passthrough was actually checked")

    def test_the_two_inputs_that_caused_the_outage(self):
        # Pinned explicitly: these are the values whose emptiness killed rung 2.
        self.assertEqual(self.inputs["codex-safety-strategy"]["default"], "drop-sudo")
        self.assertNotEqual(
            self.inputs["codex-sandbox"]["default"],
            "read-only",
            "rung 2 is the fallover for work that must be COMMITTED; a read-only Codex "
            "reports success having changed nothing.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
