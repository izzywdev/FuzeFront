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
# Usage: classify.sh <conclusion> [log-file] [step-outcome]
#   conclusion  "success" | "failure" | "" (empty = the rung reported no conclusion)
#   log-file    optional path to whatever diagnostic text the rung produced (e.g.
#               claude-code-action's execution_file). May be absent or empty.
#   step-outcome the RUNNER's own outcome for that step ("success" | "failure" |
#               "skipped" | ""). Only consulted when `conclusion` is empty, to tell
#               "could not start" from "ran and declined" — see below.
#
# Exit codes — the ONLY contract callers rely on:
#   0 = success             — no fallthrough needed
#   1 = availability-failure — safe to fall through to the next rung
#   2 = task-failure / indeterminate — do NOT fall through, fail closed
#   3 = declined             — the rung RAN and deliberately did no work. Do NOT
#                              fall through and do NOT fail: nothing is broken and
#                              there is nothing for another vendor to retry.
#
# Prints one line naming the verdict (and, on an availability match, which pattern
# fired) to stdout. NEVER prints the raw log text itself — it may carry a
# masked-but-still-sensitive provider error blob, and per the fleet secrets rule
# nothing from a provider response gets echoed wholesale into a job log.
set -euo pipefail

CONCLUSION="${1:-}"
LOG_FILE="${2:-}"
OUTCOME="${3:-}"

if [ "$CONCLUSION" = "success" ]; then
  echo "success"
  exit 0
fi

# Known AVAILABILITY-class signatures only: credit/quota exhaustion, auth failure,
# rate limiting, model-access denial, and network/5xx-class transport failure.
# Deliberately narrow and literal — broadening this list is the one change that
# turns a wrongful failover (masking a real defect) into the default outcome, which
# costs more than an unnecessary re-run ever does. Hoisted above the "declined"
# branch below because that branch now consults it too (see there).
#
# The `authentication_failed` / `key not allowed to access model` / `api_error_status: 40x`
# signatures were added after a live incident: the in-cluster LiteLLM key was
# re-scoped and rejected the model claude-code-action requested with a 403 "key not
# allowed to access model". claude-code-action swallowed that 403 into a silent
# exit-0-with-no-conclusion, which classify.sh used to read as a benign "declined"
# — hiding a real, actionable auth failure behind "the chain did no work". These
# patterns make that shape fall over (and name the error) instead.
AVAILABILITY_PATTERNS='credit balance is too low|insufficient_quota|insufficient quota|rate_limit_error|rate limit exceeded|too many requests|overloaded_error|authentication_error|authentication_failed|key not allowed to access model|invalid x-api-key|invalid api key|permission_error|forbidden|service unavailable|bad gateway|gateway timeout|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network error|fetch failed|could not connect|connection reset|"status":[[:space:]]*5[0-9][0-9]|"status":[[:space:]]*40[13]|"code":[[:space:]]*5[0-9][0-9]|"api_error_status":[[:space:]]*40[13]|"status_code":[[:space:]]*40[13]|HTTP/[0-9.]+ 5[0-9][0-9]|HTTP 5[0-9][0-9]|HTTP 429|HTTP 401|HTTP 403'

# No conclusion reported, but the STEP ITSELF SUCCEEDED. Two very different things
# produce this identical shape, and telling them apart is the whole point:
#
#   (a) claude-code-action's workflow-self-modification guard: it refuses to run
#       when the PR modifies the workflow file that invokes it ("Skipping action
#       due to workflow validation ... identical content to the version on the
#       default branch"), exits 0, and emits no conclusion. Nothing ran, nothing
#       is broken — a genuine DECLINE. Every workflow-migration PR trips it.
#   (b) claude-code-action CALLED the provider, the provider failed (e.g. a 403
#       model-access / auth error), and the action swallowed that error into a
#       silent exit-0-with-no-conclusion. This is NOT benign — it is an
#       availability failure wearing a decline's clothes.
#
# So before declaring a decline, look at the execution log: if it carries an
# availability signature, it is case (b) — classify it as availability so the chain
# falls over to the next vendor AND the specific error is named in the job log,
# rather than being buried under "the chain did no work". Only with no such
# signature is it the real case (a) decline (exit 3: do not fall through, do not
# fail). Still keyed on the runner's own report that the step SUCCEEDED, so a rung
# that genuinely could not start (outcome=failure, or none) falls through below.
if [ -z "$CONCLUSION" ] && [ "$OUTCOME" = "success" ]; then
  DECLINE_LOG=""
  if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    DECLINE_LOG="$(cat "$LOG_FILE" 2>/dev/null || true)"
  fi
  if [ -n "$DECLINE_LOG" ] && grep -Eqi "$AVAILABILITY_PATTERNS" <<<"$DECLINE_LOG"; then
    MATCH="$(grep -Eoi "$AVAILABILITY_PATTERNS" <<<"$DECLINE_LOG" | head -1)"
    echo "availability: the step exited 0 with no conclusion, but its execution log carries a provider-availability signature ('${MATCH}') — a swallowed provider error (e.g. an auth/model-access 403), not a real decline. Falling over so the error is surfaced, not masked."
    exit 1
  fi
  echo "declined: the rung ran, reported no conclusion, and its step succeeded — it did no work and did not fail (e.g. claude-code-action's workflow-self-modification guard on a workflow-migration PR)"
  exit 3
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

# AVAILABILITY_PATTERNS is defined once, hoisted above the "declined" branch — the
# same narrow, literal signature list is the classifier's single source of truth for
# what "availability" means, whether the failure arrived as an explicit
# conclusion=failure (here) or as a swallowed exit-0-with-no-conclusion (above).
if grep -Eqi "$AVAILABILITY_PATTERNS" <<<"$LOG_TEXT"; then
  MATCH="$(grep -Eoi "$AVAILABILITY_PATTERNS" <<<"$LOG_TEXT" | head -1)"
  echo "availability: matched pattern '${MATCH}'"
  exit 1
fi

echo "task: failure with no availability signature matched — failing closed (this is the honest default; an unrecognized failure mode must never be retried into a green)"
exit 2
