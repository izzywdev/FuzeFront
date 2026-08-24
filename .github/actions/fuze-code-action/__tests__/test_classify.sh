#!/usr/bin/env bash
# Self-test for classify.sh — the one decision fuze-code-action makes at every
# rung boundary.
#
# The point of this file is NOT to show classify.sh passes on clean input. It is
# to assert it REFUSES to fall through in every case where falling through would
# convert an honest red into a green. A test suite that only checks the happy path
# is the same vacuous-gate shape this action was written to avoid, so the bulk of
# the cases below assert exit 2 (do NOT fall through).
#
#   0 = success · 1 = availability (fall through) · 2 = task/indeterminate (do not)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLASSIFY="${HERE}/../classify.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0

# expect <want-code> <description> <conclusion> [log-body]
expect() {
  local want="$1" desc="$2" conclusion="$3" body="${4-}" logfile="" got out
  if [ $# -ge 4 ]; then
    logfile="${TMP}/log.$RANDOM"
    printf '%s' "$body" > "$logfile"
  fi
  if out="$("$CLASSIFY" "$conclusion" "$logfile" 2>&1)"; then got=0; else got=$?; fi
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    echo "FAIL: ${desc}"
    echo "      want exit ${want}, got ${got}"
    echo "      output: ${out}"
  fi
}

# ── success ──────────────────────────────────────────────────────────────────
expect 0 "success conclusion is success"                       "success"
expect 0 "success wins even with scary log text"               "success" "credit balance is too low"

# ── availability: safe to fall through ───────────────────────────────────────
expect 1 "empty conclusion = action-could-not-start"           ""
expect 1 "credit exhaustion"        "failure" "Error: Your credit balance is too low to access the API"
expect 1 "insufficient_quota"       "failure" '{"error":{"code":"insufficient_quota"}}'
expect 1 "rate limit"               "failure" '{"type":"rate_limit_error","message":"..."}'
expect 1 "overloaded"               "failure" '{"type":"overloaded_error"}'
expect 1 "auth error"               "failure" '{"type":"authentication_error"}'
expect 1 "invalid api key"          "failure" "invalid x-api-key"
expect 1 "HTTP 429"                 "failure" "HTTP 429 Too Many Requests"
expect 1 "HTTP 401"                 "failure" "HTTP 401"
expect 1 "5xx status field"         "failure" '{"status": 503}'
expect 1 "gateway timeout"          "failure" "504 Gateway Timeout"
expect 1 "connection refused"       "failure" "connect ECONNREFUSED 10.0.0.1:4000"
expect 1 "dns failure"              "failure" "getaddrinfo EAI_AGAIN litellm.fuzeinfra.svc"
expect 1 "fetch failed"             "failure" "TypeError: fetch failed"
expect 1 "case-insensitive match"   "failure" "SERVICE UNAVAILABLE"

# ── task / indeterminate: MUST NOT fall through ──────────────────────────────
# These are the cases that matter. Every one of them, if misclassified as
# availability, would retry a genuine failure against another vendor.
expect 2 "failure with no log at all"                          "failure"
expect 2 "failure with an empty log"                           "failure" ""
expect 2 "a real review finding"    "failure" "Found 3 issues: unchecked null deref at src/a.ts:42"
expect 2 "a real build break"       "failure" "error TS2345: Argument of type 'string' is not assignable"
expect 2 "test failure"             "failure" "2 failing
  1) auth middleware rejects an expired token"
expect 2 "lint failure"             "failure" "eslint: 4 problems (4 errors, 0 warnings)"
expect 2 "unrecognised failure mode is NOT retried" "failure" "something nobody has seen before"
expect 2 "nonzero exit with a stack trace"  "failure" "Traceback (most recent call last):
  File \"x.py\", line 1"

# A missing log FILE (path given, file absent) is indeterminate, not availability.
MISSING="${TMP}/definitely-not-here"
if out="$("$CLASSIFY" "failure" "$MISSING" 2>&1)"; then got=0; else got=$?; fi
if [ "$got" = "2" ]; then PASS=$((PASS+1)); else
  FAIL=$((FAIL+1)); echo "FAIL: missing log file must be indeterminate (want 2, got ${got})"
fi

# ── the log text itself must never be echoed ─────────────────────────────────
# classify.sh prints a verdict, never the raw provider blob, which may carry a
# masked-but-sensitive error body.
SECRET_ISH="sk-ant-DO-NOT-PRINT-THIS credit balance is too low"
LF="${TMP}/secret.log"; printf '%s' "$SECRET_ISH" > "$LF"
out="$("$CLASSIFY" "failure" "$LF" 2>&1 || true)"
if grep -q "DO-NOT-PRINT-THIS" <<<"$out"; then
  FAIL=$((FAIL+1)); echo "FAIL: classify.sh echoed raw log text into its verdict"
else
  PASS=$((PASS+1))
fi

echo
echo "classify.sh self-test: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" = "0" ]
