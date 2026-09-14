#!/usr/bin/env python3
"""Derive (conclusion, result-text) from claude-code-action's execution_file.

WHY THIS EXISTS — the bug it fixes. The pinned `anthropics/claude-code-action`
is a COMPOSITE action, and its declared `outputs:` are exactly
`execution_file, branch_name, github_token, structured_output, session_id` —
there is NO `conclusion` output. Its inner entrypoint does call
`core.setOutput("conclusion", ...)`, but that sets an output on the composite's
own inner step; a composite only exposes the outputs it DECLARES, so a caller of
the action (this repo's fuze-code-action) reads `steps.<rung>.outputs.conclusion`
as ALWAYS EMPTY, on success and failure alike.

classify.sh then sees an empty conclusion with the runner step reporting
`outcome=success` and — finding no provider-availability signature in the
execution log — returns exit 3 = "declined". So EVERY successful headless review
(both the subscription-OAuth rung 1a and the metered rung 1) was classified as a
decline, `mode=declined` / `conclusion=neutral` / "NO WORK WAS PERFORMED", and
fuze-code-review could never approve or comment. Verified on izzywdev/FuzeSDLC
PR #327 run 34395249476: OAUTH_CODE=3, step outcome=success, empty conclusion,
empty sensitive-files, no availability signature.

A second, latent defect surfaces once the first is fixed: fuze-code-action read
its `result-text` from `structured_output`, which claude-code-action ONLY
populates when `--json-schema` is passed in `claude_args`. fuze-code-review
passes only `--allowedTools`, so `structured_output` is empty and the verdict
parser would abstain ("reviewer produced no output at all") even with a correct
conclusion. The real review text lives in the execution file.

THE REAL SIGNAL. The execution file is `JSON.stringify(messages)` — a JSON array
of Agent-SDK messages (`base-action/src/execution-file.ts`). Its final
`type == "result"` record is an `SDKResultMessage`
(`@anthropic-ai/claude-agent-sdk`), a discriminated union:
  * success: `{type:"result", subtype:"success", is_error:false, result:"<final
    assistant text>", ...}`
  * error:   `{type:"result", subtype:"error_max_turns"|"error_during_execution"
    |"error_max_budget_usd"|"error_max_structured_output_retries", is_error:true,
    errors:[...]}`  — NO `result` field.
So `subtype == "success"` (and `is_error` not true) is the authoritative
success signal, and `result` is the text the verdict parser needs.

CONTRACT — this script is a DERIVER, not the classifier. It never decides
availability-vs-task (that stays in classify.sh) and never manufactures a green:

  conclusion:
    "success"  iff a result record exists with subtype=="success" and is_error
               is not true.
    "failure"  iff a result record exists with any other subtype / is_error true.
    ""         (empty) when the file is absent, empty-path, unparseable, not a
               JSON array, or carries no result record at all. Empty is passed
               straight to classify.sh, whose existing empty-conclusion branches
               then apply UNCHANGED — with step outcome=success and no
               availability signature that is the genuine "declined" path
               (claude-code-action's workflow-self-modification guard, or an
               early no-trigger return); with outcome=failure it is
               "action-could-not-start" = availability. No fabricated success in
               any branch.

  result-text:
    the success record's `result` string, else the error record's `errors`
    joined (best effort, for surfacing), else empty.

Writes `conclusion` and a nonce-delimited `result-text` to $GITHUB_OUTPUT (or
prints a JSON summary when unset, for local testing). ALWAYS exits 0: a failure
to read the file is expressed as an empty conclusion (the safe, fail-closed
direction), never as a crash that would red the composite.

The raw `result` text is written ONLY to $GITHUB_OUTPUT (a masked action
output), never echoed to a log line — same secrets rule classify.sh follows.
"""
from __future__ import annotations

import json
import os
import secrets
import sys


def derive(execution_file: str) -> tuple[str, str]:
    """Return (conclusion, result_text) per the contract in the module docstring."""
    if not execution_file or not os.path.isfile(execution_file):
        return "", ""
    try:
        with open(execution_file, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        # Present but unreadable/corrupt. Not a success and not a genuine
        # decline; report empty so classify.sh + the step outcome decide,
        # which never manufactures a green.
        return "", ""
    if not isinstance(data, list):
        return "", ""

    result_msg = None
    for msg in data:
        if isinstance(msg, dict) and msg.get("type") == "result":
            result_msg = msg  # last result record wins (there is normally one)
    if result_msg is None:
        return "", ""

    subtype = result_msg.get("subtype")
    is_error = result_msg.get("is_error")
    conclusion = "success" if (subtype == "success" and is_error is not True) else "failure"

    result_text = result_msg.get("result")
    if not isinstance(result_text, str) or not result_text:
        errors = result_msg.get("errors")
        if isinstance(errors, list) and errors:
            result_text = "\n".join(str(e) for e in errors)
        else:
            result_text = ""

    return conclusion, result_text


def _write_output(conclusion: str, result_text: str) -> None:
    out_path = os.environ.get("GITHUB_OUTPUT")
    if not out_path:
        # Local/test invocation: emit a compact JSON summary on stdout. The
        # result text is included here only because there is no secret sink to
        # protect in a local run; in CI it goes solely to $GITHUB_OUTPUT.
        print(json.dumps({"conclusion": conclusion, "result-text": result_text}))
        return
    delim = f"FUZE_EXEC_RESULT_{secrets.token_hex(8)}"
    with open(out_path, "a", encoding="utf-8") as fh:
        fh.write(f"conclusion={conclusion}\n")
        fh.write(f"result-text<<{delim}\n{result_text}\n{delim}\n")


def main(argv: list[str]) -> int:
    execution_file = argv[1] if len(argv) > 1 else ""
    conclusion, result_text = derive(execution_file)
    _write_output(conclusion, result_text)
    # NEVER echo the result text. Naming only the derived conclusion is safe and
    # matches classify.sh, which prints its verdict but never the raw log body.
    print(f"::notice title=fuze-code-action::derived conclusion={conclusion or '(empty)'} "
          f"from execution_file (result text captured to output, not printed).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
