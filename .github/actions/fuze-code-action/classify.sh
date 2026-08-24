#!/usr/bin/env bash
# classify.sh — the ONE decision fuze-code-action makes at every rung boundary:
# was this an AVAILABILITY failure (safe to fall through to the next provider) or a
# TASK failure / something we cannot tell (must NOT fall through)?
#
# Falling through on a real task failure is worse than not building the fallback at
# all: retrying a genuine review finding, failed build, or non-zero from the work
# itself against a second vendor converts an honest failure into a green. So this
# script is deliberately conservative — see the "indeterminate" and "task" branches
# below, both of which exit 2 (do NOT fall through) rather than guess.
#
# Usage: classify.sh <conclusion> [log-file]
#   conclusion  "success" | "failure" | "" (empty = the rung never reported a
#               conclusion at all, e.g. it crashed before running / could not start)
#   log-file    optional path to whatever diagnostic text the rung produced (e.g.
#               claude-code-action's execution_file). May be absent or empty.
#
# Exit codes — the ONLY contract callers rely on:
#   0 = success             — no fallthrough needed
#   1 = availability-failure — safe to fall through to the next rung
#   2 = task-failure / indeterminate — do NOT fall through, fail closed
#
# Prints one line naming the verdict (and, on an availability match, which pattern
# fired) to stdout. NEVER prints the raw log text itself — it may carry a
# masked-but-still-sensitive provider error blob, and per the fleet secrets rule
# nothing from a provider response gets echoed wholesale into a job log.
set -euo pipefail

CONCLUSION="${1:-}"
LOG_FILE="${2:-}"

if [ "$CONCLUSION" = "success" ]; then
  echo "success"
  exit 0
fi

# No conclusion reported at all = the rung could not even start (action resolution
# failure, runner crash before the process ran, etc.). That IS an availability
# failure by definition — matches the "action-could-not-start" fallthrough class.
if [ -z "$CONCLUSION" ]; then
  echo "availability: no conclusion reported (action-could-not-start)"
  exit 1
fi

LOG_TEXT=""
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
  LOG_TEXT="$(cat "$LOG_FILE" 2>/dev/null || true)"
fi

if [ -z "$LOG_TEXT" ]; then
  # A failure with nothing to classify against. Per the fleet rule ("if you cannot
  # reliably distinguish the two for a given action, default to NOT falling
  # through"), treat this as indeterminate and fail closed rather than guess.
  echo "indeterminate: failure with no diagnostic text available — failing closed"
  exit 2
fi

# Known AVAILABILITY-class signatures only: credit/quota exhaustion, auth failure,
# rate limiting, and network/5xx-class transport failure. Deliberately narrow and
# literal — broadening this list is the one change that turns a wrongful failover
# (masking a real defect) into the default outcome, which costs more than an
# unnecessary re-run ever does.
AVAILABILITY_PATTERNS='credit balance is too low|insufficient_quota|insufficient quota|rate_limit_error|rate limit exceeded|too many requests|overloaded_error|authentication_error|invalid x-api-key|invalid api key|permission_error|forbidden|service unavailable|bad gateway|gateway timeout|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network error|fetch failed|could not connect|connection reset|"status":[[:space:]]*5[0-9][0-9]|"code":[[:space:]]*5[0-9][0-9]|HTTP/[0-9.]+ 5[0-9][0-9]|HTTP 5[0-9][0-9]|HTTP 429|HTTP 401|HTTP 403'

if grep -Eqi "$AVAILABILITY_PATTERNS" <<<"$LOG_TEXT"; then
  MATCH="$(grep -Eoi "$AVAILABILITY_PATTERNS" <<<"$LOG_TEXT" | head -1)"
  echo "availability: matched pattern '${MATCH}'"
  exit 1
fi

echo "task: failure with no availability signature matched — failing closed (this is the honest default; an unrecognized failure mode must never be retried into a green)"
exit 2
