# fuze-code-review hangs to a 20-minute force-cancel: runner-loss evidence

> **Status (2026-10-04):** investigation complete on the FuzeFront side; root cause is
> on the `fuzefront` ARC runner scale set, which **FuzeInfra owns**. The `@fuze`
> delegation at the bottom of this page is a **DRAFT, NOT SENT**.
> One in-repo hardening was identified but must land in FuzeSDLC (see "In-repo findings").

## Symptom

`fuze-code-review` (`.github/workflows/fuze-code-review.yml`, `runs-on: fuzefront`) sits with
the step **Run automated review** (`./.github/actions/fuze-code-action`, step
`timeout-minutes: 12`) `in_progress` until GitHub force-completes the job at **exactly
job-timeout + 5 minutes**. Neither the step timeout nor the job timeout ends the work. No
step after it runs (no `Post …`, no `Complete job`), so `Decide verdict` never classifies the
outage, and the job logs are not retrievable (HTTP 404).

Measured on PR #1234, head `5a2dc687` (job timeout 15 → force-cancel at 20:00):

| Run / attempt | Job | Runner | Job start → end (UTC, 2026-10-04) | Duration |
|---|---|---|---|---|
| 37199207685 / 1 | 111427323819 | `fuzefront-jph9j-runner-kf7np` | 11:35:31 → 11:55:31 | **20:00** |
| 37199207685 / 2 | 111430838728 | `fuzefront-jph9j-runner-9ntsm` | 11:57:15 → 12:17:15 | **20:00** |

In both, `Run automated review` started ~12s into the job and the runner never reported
it finished. Its own 12-minute step timeout would have fired at ~11:47:43 / ~12:09:25 —
it never reached GitHub.

## Is it repo-wide? Yes.

Source: GitHub Actions API via the GitHub MCP tools (`list_workflow_runs` for
`fuze-code-review.yml`, all branches, 5 pages × 100 = **500 runs**, covering
**2026-09-23T12:36Z → 2026-10-04T12:26Z**, ~11 days; then `list_workflow_jobs` on every
failed run and on every cancelled run whose duration was not explained by queueing or
concurrency, plus a healthy sample).

Run-level conclusions in the window: 308 success, 166 cancelled, 7 failure, 16 skipped,
1 action_required, 2 still running. Most of the 166 cancellations are benign:
`cancel-in-progress` concurrency superseding a run within 1–4 minutes (each one ran
`Post` steps and `Complete job`, so the runner honoured the cancel), or jobs that **never got a
runner** (no `runner_name`; see "Separate issue" below).

### Every job where the review step outran its budget

The config changed three times in this window, which is why the force-cancel lands at
different points:

| Window | Step timeout | Job timeout | Runner lost → shows as |
|---|---|---|---|
| until 2026-09-24 10:39Z (#1180) | none | none (360 default) | `failure`, no steps recorded ("lost communication") |
| 09-24 12:27Z (#1119) → 10-04 12:23Z | 12 | 12 | `cancelled` at exactly **17:00** |
| from 10-04 12:23Z (#1234) | 12 | 15 | `cancelled` at exactly **20:00** |

**Class B: runner lost (nothing acknowledged after the review step started)**

| Run | Job | Runner | Branch @ sha | Job start → end (UTC) | Dur |
|---|---|---|---|---|---|
| 37199207685/2 | 111430838728 | `fuzefront-jph9j-runner-9ntsm` | claude/selectionlist-microservice-uj9nol @ 5a2dc687 | 10-04 11:57:15 → 12:17:15 | 20:00 |
| 37199207685/1 | 111427323819 | `fuzefront-jph9j-runner-kf7np` | claude/selectionlist-microservice-uj9nol @ 5a2dc687 | 10-04 11:35:31 → 11:55:31 | 20:00 |
| 36600992480 | 109518326050 | `fuzefront-jph9j-runner-nwrx5` | feat/connector-platform-batch-01 @ 566134b0 | 09-29 16:54:20 → 17:11:20 | 17:00 |
| 36412928010 | 108897161041 | `fuzefront-jph9j-runner-982wn` | feat/otel-telemetry-tracing @ fc410fc1 | 09-28 10:59:30 → 11:16:30 | 17:00 |
| 36410605921 | 108889636577 | `fuzefront-jph9j-runner-pwbm8` | feat/otel-telemetry-tracing @ f3872c59 | 09-28 10:35:46 → 10:52:46 | 17:00 |
| 36393185185 | 108833410245 | `fuzefront-jph9j-runner-4g8ld` | feat/otel-telemetry-tracing @ c4d6c03c | 09-28 07:43:29 → 08:00:29 | 17:00 |
| 36364645280 | 108748528995 | `fuzefront-jph9j-runner-xgp8l` | feat/otel-telemetry-tracing @ c2f17f57 | 09-28 01:21:29 → 01:38:29 | 17:00 |
| 35912835173 | 107356750537 | `fuzefront-xfxqd-runner-thgvm` | claude/config-service-lifecycle-events @ 567f09c9 | 09-23 19:59:33 → 20:13:35 | 14:02 (failure) |
| 35906968854 | 107336949747 | `fuzefront-xfxqd-runner-z57qh` | claude/config-service-lifecycle-events @ c176a80f | 09-23 19:10:40 → 19:26:43 | 16:03 (failure) |
| 35903669764 | 107325835648 | `fuzefront-xfxqd-runner-zm9q5` | claude/config-service-lifecycle-events @ 936d4169 | 09-23 18:39:57 → 18:56:02 | 16:05 (failure) |
| 35892443689 | 107287988562 | `fuzefront-xfxqd-runner-98pdg` | claude/config-service-lifecycle-events @ 481d498f | 09-23 16:58:52 → 17:11:55 | 13:03 (failure) |
| 35883904095 | 107259045305 | `fuzefront-xfxqd-runner-fj6m2` | claude/config-service-lifecycle-events @ e757a892 | 09-23 15:46:15 → 16:02:18 | 16:03 (failure) |
| 35862989541 | 107187526315 | `fuzefront-xfxqd-runner-hwk8j` | claude/trusting-ritchie-ecep0e @ de3d676a | 09-23 12:56:38 → 13:12:40 | 16:02 (failure) |

**Class A: same overrun, but the runner honoured the timeout** (step reported `cancelled`,
`Post` steps and `Complete job` ran within seconds):

| Run | Job | Runner | Branch @ sha | Job start → end (UTC) | Dur |
|---|---|---|---|---|---|
| 37196039671/1 | 111417999332 | `fuzefront-jph9j-runner-msx8z` | claude/selectionlist-microservice-uj9nol @ 45dcc50e | 10-04 10:39:21 → 10:51:38 | 12:17 |
| 37189577432 | 111398775519 | `fuzefront-jph9j-runner-kdgcc` | claude/multi-tenant-portal-arch-k5b8fy @ 3aef7582 | 10-04 08:39:00 → 08:51:21 | 12:21 |
| 37187779938 | 111393318662 | `fuzefront-jph9j-runner-tb4sh` | claude/selectionlist-ui-unit-tests @ e94de531 | 10-04 08:09:52 → 08:22:14 | 12:22 |
| 37186865516 | 111390529805 | `fuzefront-jph9j-runner-ntgmn` | claude/selectionlist-ui-unit-tests @ 722dc2d6 | 10-04 07:47:50 → 08:00:15 | 12:25 |
| 36010287885 | 107668921031 | `fuzefront-xfxqd-runner-fqtsw` | ds-extraction/929-center-primitive @ 890af1f0 | 09-24 14:11:39 → 14:24:27 | 12:48 |
| 36009462755 | 107666116291 | `fuzefront-xfxqd-runner-xqrt8` | claude/fuzefront-public-site-hhmj1v @ 2a3609d3 | 09-24 13:59:44 → 14:12:19 | 12:35 |
| 35993970496 | 107614412300 | `fuzefront-xfxqd-runner-jfhqf` | claude/members-tabs-fetch-error-jlz4ew @ 15132ef6 | 09-24 11:38:10 → 11:51:05 | 12:55 (step timed out at 12:16; verdict failed) |

**Healthy sample (for contrast).** `Run automated review` finished in 2:07–7:53:
37201543270 (`-q9h4n`, 2:07, 10-04 12:16Z, **while `-9ntsm` was hung**),
37197475345 (`-8lrh5`, 2:38), 36637328838 (`-t25n8`, 2:32), 37192364112 (`-f7g6c`, 3:36),
37188296778 (`-6fx4n`, 4:08), 37186307019 (`-68vvf`, 5:23), 36362711802 (`-z5jvm`, 7:53).

### Runner-name correlation: none, by construction

Every `runner_name` is an **ephemeral** ARC pod (`fuzefront-<set>-runner-<pod>`). None repeats
across jobs, so no single bad runner is involved. The only grouping is the **scale-set
generation**: `fuzefront-xfxqd-*` (seen up to 2026-09-24) and `fuzefront-jph9j-*` (seen from
2026-09-28). Runner loss happens under **both**, so it predates the recreated scale set.

## Proven vs inferred

**Proven (from the API data above):**

1. The force-cancel pattern is **repo-wide**: 13 lost-runner jobs across 5 branches/PRs and
   13 different ephemeral pods in two scale-set generations, 2026-09-23 → 2026-10-04. It is not
   specific to PR #1234.
2. In class B, after `Run automated review` started, **no step update from the runner reached
   GitHub**: not the runner's own 12-minute step timeout (which the runner enforces itself),
   not the job-timeout cancel, no `Post` steps, no `Complete job`. GitHub finalised each job at
   exactly job-timeout + 5 min. Before any timeout was configured, the same loss surfaced as a
   `failure` with no steps recorded, the shape GitHub gives "lost communication with the server".
3. The **same step code** honoured the same timeout cleanly in class A (cancelled in seconds,
   post-steps ran) on other pods of the same scale set, the same day, for the same PR (#1234 head
   `45dcc50e` on `-msx8z`). So "the step ignores SIGTERM" does not explain class B: a healthy
   runner kills it.
4. In all 7 class-B jobs that have step data, the runner went silent **during
   `Run automated review`**. Every earlier step completed within ~35s of job start. None of the 7
   lost its runner in any other step, and none of the sampled healthy reviews (2–8 min) did.
   *When* inside the step each loss happened is not recorded: anywhere from the step's start
   to its 12-minute mark.
5. Of the ~20 jobs found that ended on a review-step timeout or a lost runner, 13 lost the
   runner and 7 timed out cleanly (class A).

**Inferred (not provable from FuzeFront; needs the cluster):**

- Class B is the **runner pod/process dying or losing its network mid-step**: OOMKill of the
  runner container, eviction (ephemeral-storage or node pressure), the Runner.Worker wedged on an
  un-reapable child (D-state), or a network partition from GitHub. The API cannot tell these apart.
  Pod events, the EphemeralRunner status, and node logs can.
- That the loss is tied to the **long, outage-driven reviews** and is not random pod churn.
  Class A shows these overruns happen (the step runs until it is timed out), and the losses
  cluster in the same outage windows (09-23, 09-28, 10-04). But the loss time inside the step
  is unknown.
- A plausible trigger is the **workload of the fallover cascade** on an outage: rung 1a and
  rung 1 (claude-code-action, twice), then rung 2 (codex-action installs the Codex CLI and runs
  it with `sandbox: danger-full-access`), then rung 3 (run-gemini-cli installs the Gemini CLI;
  it ran ~7 min in run 37196039671). Each rung installs a toolchain into the ephemeral pod.
  Memory or ephemeral-storage pressure from that is a candidate. **Unverified.**
- The lost-runner jobs cluster on **large PRs** (4 on `feat/otel-telemetry-tracing` on 09-28;
  #1234). A prompt carrying the 80 KB diff to every rung would raise per-rung memory.
  **Unverified correlation.**

**Not proven either way:** which rung was running when each pod was lost. The job logs are
404 (blob downloads are blocked from this environment and were not circumvented). Composite
inner steps are not listed in the jobs API, which shows only the 10 top-level steps.

## In-repo findings

1. **Found, NOT fixable in this repo: unbounded `docker` CLI calls in `./.github/actions/llm-endpoint`.**
   On the runner-local LiteLLM fallback path, `docker run -d` (which includes a **cold image
   pull** on every ephemeral pod), `docker logs` and `docker rm -f` have no wall-clock bound. The
   45s readiness loop only starts after `docker run` returns, so a stuck pull or a wedged dind
   daemon holds the step open for the caller's entire budget. A timeout returns rc 124/137 into
   the existing `run_rc != 0` branch, which degrades to direct Anthropic, so no availability
   path would become unavailable and no classification rule would change.
   **Why it is not in this PR:** `.github/actions/llm-endpoint/action.yml` is a FuzeSDLC-managed
   file (`.fuze/installed.json`). The governance-sync bot resets managed files to the canonical on
   every PR push, and it reverted this fix (commit "reconcile managed files to FuzeSDLC v1"). The
   change has to land in the FuzeSDLC canonical and sync down. The patch, as originally tested
   (it failed the hang test before and passed it in ~2s after, against a stub `docker` whose `run`
   never returns), is below for that PR.
   *Scope note:* on the `fuzefront` runner the in-cluster LiteLLM path is normally taken, so this
   is **hardening, not the proven cause** of class B.

   <details><summary>Patch for FuzeSDLC canonical</summary>

   ```diff
commit 3352c249368c3b16630c430d236f4b471476ddc6
Author: Claude <noreply@anthropic.com>
Date:   Sun Oct 4 12:39:54 2026 +0000

    fix(ci): bound llm-endpoint docker CLI calls; document fuze-code-review runner-loss evidence
    
    fuze-code-review's "Run automated review" step was force-cancelled at exactly
    job-timeout + 5 min on PR #1234 (runs 37199207685 a1/a2). The Actions API across
    500 runs (2026-09-23 -> 2026-10-04) shows this is repo-wide: 13 jobs on 13
    ephemeral `fuzefront` pods (both the xfxqd and jph9j scale-set generations) went
    silent mid-step. The runner never acted on its own step timeout or the job
    cancel. Other pods of the same set honoured the identical timeout cleanly the
    same day. The cause is runner/pod loss on FuzeInfra's scale set, not a step that
    ignores SIGTERM.
    
    docs/runbooks/fuze-code-review-runner-hang.md carries the evidence tables
    (run/job ids, runner names, timestamps), what is proven vs inferred, and a
    DRAFT, NOT SENT @fuze delegation to FuzeInfra.
    
    In-repo hardening found on the way: llm-endpoint's runner-local fallback ran
    `docker run -d` (a cold image pull on every ephemeral pod), `docker logs` and
    `docker rm -f` with no wall-clock bound, so a stuck pull or a wedged dind daemon
    held the caller's step open. These are now wrapped in `timeout`, and the
    existing rc != 0 branch still degrades to direct Anthropic, so availability
    classification is unchanged. Pinned by a new test, wired into
    gate-fuze-code-action. The test fails against the pre-fix action and passes on
    the fix.
    
    Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_018PKRvNfpskTKPUfDc8X1G1

diff --git a/.github/actions/llm-endpoint/action.yml b/.github/actions/llm-endpoint/action.yml
index ba7b770e..d098c6d0 100644
--- a/.github/actions/llm-endpoint/action.yml
+++ b/.github/actions/llm-endpoint/action.yml
@@ -629,7 +629,22 @@ runs:
         # "Process completed with exit code 125" and no docker-run.log, leaving
         # the actual cause invisible. A tested context is the one place errexit
         # is defined not to apply.
-        if docker run -d --rm \
+        #
+        # WALL-CLOCK BOUND on every docker CLI call in this step. `docker run -d`
+        # includes the IMAGE PULL, and every ARC runner pod is ephemeral, so the
+        # pull is always cold (multi-hundred-MB LiteLLM image). Unbounded, a slow
+        # registry or a wedged dind daemon held this step -- and the whole
+        # `Run automated review` budget of every caller -- with nothing below it
+        # ever firing: the 45s readiness loop only starts AFTER `docker run`
+        # returns. `timeout` turns that into rc=124, which the existing
+        # run_rc != 0 branch already degrades to direct Anthropic. If `timeout`
+        # itself is missing the rc is 127 and the same degrade path applies, so
+        # this cannot make an available path unavailable. Diagnosed while
+        # investigating the fuze-code-review runner hang
+        # (docs/runbooks/fuze-code-review-runner-hang.md).
+        DOCKER_RUN_TIMEOUT="${LOCAL_LITELLM_DOCKER_RUN_TIMEOUT:-180}"
+        DOCKER_CLI_TIMEOUT=30
+        if timeout --signal=TERM --kill-after=10s "${DOCKER_RUN_TIMEOUT}" docker run -d --rm \
           --name fuze-llm-fallback \
           -p "127.0.0.1:${PORT}:4000" \
           --env-file "$ENV_FILE" \
@@ -680,6 +695,12 @@ runs:
         }
 
         if [ $run_rc -ne 0 ]; then
+          if [ "$run_rc" -eq 124 ] || [ "$run_rc" -eq 137 ]; then
+            echo "::error title=llm-endpoint::docker run (image pull + start) did not finish within ${DOCKER_RUN_TIMEOUT}s (rc=${run_rc}) -- killed rather than left to hold the job open."
+            # The daemon may still create the container after the CLI was killed;
+            # remove it (bounded) so a late-starting proxy cannot hold the port.
+            timeout --kill-after=5s "${DOCKER_CLI_TIMEOUT}" docker rm -f fuze-llm-fallback >/dev/null 2>&1 || true
+          fi
           echo "::error title=llm-endpoint::docker run failed to start the runner-local LiteLLM fallback container (rc=${run_rc}). Log (redacted):"
           while IFS= read -r line; do redact "$line"; done < "${WORKDIR}/docker-run.log"
           degrade_to_anthropic "runner-local LiteLLM could not be started (docker rc=${run_rc})"
@@ -698,8 +719,8 @@ runs:
 
         if [ "$ready" != true ]; then
           echo "::error title=llm-endpoint::runner-local LiteLLM fallback container did not become ready within ${LOCAL_LITELLM_STARTUP_TIMEOUT:-45}s (waited ${elapsed}s). Container logs (redacted):"
-          docker logs fuze-llm-fallback 2>&1 | while IFS= read -r line; do redact "$line"; done
-          docker rm -f fuze-llm-fallback >/dev/null 2>&1 || true
+          timeout --kill-after=5s "${DOCKER_CLI_TIMEOUT}" docker logs fuze-llm-fallback 2>&1 | while IFS= read -r line; do redact "$line"; done
+          timeout --kill-after=5s "${DOCKER_CLI_TIMEOUT}" docker rm -f fuze-llm-fallback >/dev/null 2>&1 || true
           degrade_to_anthropic "runner-local LiteLLM did not become ready within ${LOCAL_LITELLM_STARTUP_TIMEOUT:-45}s"
         fi
 
@@ -716,7 +737,7 @@ runs:
         serve_probe "http://127.0.0.1:${PORT}" "${LOCAL_MASTER_KEY}"
         if [ "$SERVE_RESULT" != "ok" ]; then
           echo "::warning title=llm-endpoint::runner-local LiteLLM became ready but its authenticated serve probe did NOT pass (result=${SERVE_RESULT}, HTTP ${SERVE_PROBE_CODE}) — the chain [${AVAILABLE[*]}] refused a real inference call."
-          docker rm -f fuze-llm-fallback >/dev/null 2>&1 || true
+          timeout --kill-after=5s "${DOCKER_CLI_TIMEOUT}" docker rm -f fuze-llm-fallback >/dev/null 2>&1 || true
           degrade_to_anthropic "runner-local LiteLLM answered readiness but failed the authenticated serve probe (result=${SERVE_RESULT}, HTTP ${SERVE_PROBE_CODE})"
         fi
         echo "::notice title=llm-endpoint::mode=fallback-local-litellm vendor=${primary_vendor} — runner-local LiteLLM (chain=[${AVAILABLE[*]}], skipped-no-key=[${SKIPPED[*]:-none}]) became ready in ${elapsed}s and passed an authenticated serve probe (HTTP ${SERVE_PROBE_CODE}). LiteLLM's own router_settings.fallbacks will auto-advance past ${primary_vendor} on a quota/rate-limit/auth error without another workflow run."
   ```

   </details>
2. **No in-repo defect makes the step ignore cancellation.** Every rung is a third-party
   `uses:` action (claude-code-action, codex-action, run-gemini-cli). There is no in-repo
   `claude`/`codex`/`gemini` CLI invocation to wrap in `timeout`. The composite's own `run:`
   blocks (export, parse, classify, finish) are bounded local scripts with no background
   processes. Per-rung `timeout-minutes` inside the composite was **not** added: support for
   that key on composite-action steps could not be verified from this session (the
   `actions/runner` schema was unreachable). An unsupported key would break the action for every
   caller. The step-level `timeout-minutes: 12` on the caller remains the bound, and class A shows
   it works when the runner is alive.
3. **Reported, NOT changed (out of scope, behaviour change): the review's "no tools" property
   holds only on the Anthropic rungs.** `fuze-code-review.yml` restricts the reviewer to
   `--allowedTools "Read,Grep,Glob"` through `claude-args`. That input reaches the two
   claude-code-action rungs only. On fallover, rung 2 runs Codex with the composite default
   `codex-sandbox: danger-full-access`, i.e. full shell on the runner. The checkout persists the
   job's `GITHUB_TOKEN` (`pull-requests: write`) in `.git/config`. Rung 3's tool policy depends on
   run-gemini-cli defaults, which were not verified. This contradicts the workflow header's claim
   that "an instruction smuggled inside the diff has no tool available to act on it." It is also
   a plausible source of heavy, unbounded work on the runner pod. A fix needs a decision, because
   it changes the fallover chain's behaviour. Options are `codex-sandbox: read-only` for this
   caller (which may make the codex rung fail to start in the nested container, per the
   composite's own note) or dropping `openai-api-key` from this caller. Offered as a follow-up,
   not applied here.

## Separate issue (not the hang): jobs that never got a runner

Several long "cancelled" runs, mostly 2026-09-24 → 09-28, never had a runner assigned:
`list_workflow_jobs` returns no `runner_name` or steps. Examples: 36362701949, 36363364887,
36330307316, 36325823981, 36126768071, 36041948257, 36041541453. 19 more sat for exactly
~24h (e.g. 36040015412, 36282819393), which looks like GitHub's queued-job expiry (inferred).
This is scale-set **capacity/availability**, not the in-step hang. It is mentioned in the
delegation as context only.

## DRAFT `@fuze` delegation to FuzeInfra — NOT SENT

Per the cross-repo convention, this repo never operates the cluster or edits FuzeInfra.
No `capability-registry.json` exists in this repo
(`capability_delegation.py registry` → 0 entries), so this goes as a cross-repo `@fuze`
request for a human or a FuzeInfra session to pick up. **Do not treat this page as having sent
it.**

```
@fuze — FuzeInfra request from FuzeFront: `fuzefront` ARC scale-set pods are lost mid-job (13 jobs, 2026-09-23 → 2026-10-04)

## What we see (FuzeFront side, from the GitHub Actions API — no cluster access here)
Jobs on `runs-on: fuzefront` running FuzeFront's `fuze-code-review` workflow stop
reporting to GitHub partway through a long step. The runner never acts on its own step
timeout, never acknowledges the job-timeout cancel, never runs post-steps — GitHub
force-finalises the job at exactly job-timeout + 5 min (or, with no timeout, fails it
with no steps recorded, the "lost communication" shape). Other pods of the same scale set
handle the identical step and timeout cleanly the same day, so we believe the pod/runner
process is dying or partitioned, not that the step ignores SIGTERM.

Lost runners (pod name, GitHub job id, job window UTC):
  fuzefront-jph9j-runner-9ntsm  111430838728  2026-10-04 11:57:15 → 12:17:15   (freshest — start here)
  fuzefront-jph9j-runner-kf7np  111427323819  2026-10-04 11:35:31 → 11:55:31
  fuzefront-jph9j-runner-nwrx5  109518326050  2026-09-29 16:54:20 → 17:11:20
  fuzefront-jph9j-runner-982wn  108897161041  2026-09-28 10:59:30 → 11:16:30
  fuzefront-jph9j-runner-pwbm8  108889636577  2026-09-28 10:35:46 → 10:52:46
  fuzefront-jph9j-runner-4g8ld  108833410245  2026-09-28 07:43:29 → 08:00:29
  fuzefront-jph9j-runner-xgp8l  108748528995  2026-09-28 01:21:29 → 01:38:29
  fuzefront-xfxqd-runner-thgvm  107356750537  2026-09-23 19:59:33 → 20:13:35
  fuzefront-xfxqd-runner-z57qh  107336949747  2026-09-23 19:10:40 → 19:26:43
  fuzefront-xfxqd-runner-zm9q5  107325835648  2026-09-23 18:39:57 → 18:56:02
  fuzefront-xfxqd-runner-98pdg  107287988562  2026-09-23 16:58:52 → 17:11:55
  fuzefront-xfxqd-runner-fj6m2  107259045305  2026-09-23 15:46:15 → 16:02:18
  fuzefront-xfxqd-runner-hwk8j  107187526315  2026-09-23 12:56:38 → 13:12:40
Healthy contrast, same set, same hour: fuzefront-jph9j-runner-q9h4n (job 111434082807,
2026-10-04 12:16:40 → 12:19:11) and fuzefront-jph9j-runner-msx8z (job 111417999332,
timed out cleanly 10:39:21 → 10:51:38).

Workload on the lost pods: a composite that, on an LLM-provider outage, runs
claude-code-action twice, then installs+runs the Codex CLI, then installs+runs the
Gemini CLI (~7 min observed), each with a prompt carrying up to an 80 KB diff. Losses
cluster on large PRs. We suspect memory or ephemeral-storage pressure but cannot see it.

## Please investigate (read-only first)
1. For each pod above (prioritise 9ntsm / kf7np — events may have aged out for 09-23/09-28):
   pod + EphemeralRunner status and events in `arc-runners` — termination reason
   (OOMKilled? Evicted / ephemeral-storage? node pressure? preempted? Error/exit code),
   which container died (runner vs dind sidecar), restarts.
2. ARC controller + `fuzefront` listener logs for those runner names around those windows
   (did ARC delete/recreate the EphemeralRunner mid-job? any "runner not found"/re-register?).
3. Node side for the hosting nodes: kernel OOM-killer lines (dmesg/journal), kubelet
   eviction logs, containerd errors, and node network events at those times.
4. kube-state-metrics / Prometheus, if retained: container memory working set +
   ephemeral-storage for those pods vs their limits;
   kube_pod_container_status_last_terminated_reason for the `fuzefront` set.
5. The current `fuzefront` scale-set spec: container mode (dind vs kubernetes), runner and
   dind resources.requests/limits (memory, ephemeral-storage), emptyDir sizeLimit,
   terminationGracePeriodSeconds, and what changed when the set went from the `xfxqd`
   to the `jph9j` generation (between 2026-09-24 and 2026-09-28).
6. Runner `_diag` (Runner_*.log / Worker_*.log) if the pods' volumes were retained anywhere.

## The ask
- Report the termination cause for at least 9ntsm and kf7np (or say plainly that the
  evidence has aged out, and what retention would have kept it).
- If it is resource pressure: size the `fuzefront` runner (and dind) memory /
  ephemeral-storage for a job that installs three CLIs, or tell us the budget so we can
  cut the workload on our side.
- If it is something else (ARC reaping, node churn, network), fix it or tell us what
  FuzeFront should change in the job.
- Separately (context, lower priority): 2026-09-24 → 09-28 many `fuzefront` jobs were
  never assigned a runner and expired after ~24h (e.g. runs 36040015412, 36282819393) —
  a capacity/availability gap worth a look.

Reply with findings + any FuzeInfra PR links. No credentials in the reply.
Evidence page in FuzeFront: docs/runbooks/fuze-code-review-runner-hang.md
```

## What could not be verified from this session

- Job logs for any affected job (HTTP 404; blob downloads blocked; not circumvented).
- Which rung was running at the moment each pod was lost.
- Any cluster-side fact (pod termination reason, limits, events). That is FuzeInfra's, via the
  delegation above.
- Whether composite-action steps accept `timeout-minutes` (so it was not used).
- run-gemini-cli / codex-action / claude-code-action internals at the pinned SHAs (upstream
  repos were not reachable from this session).
- Runs older than 2026-09-23T12:36Z (the 500-run window). Concurrency-cancelled jobs shorter
  than ~12 min were spot-checked, not exhaustively listed. A loss masked by a concurrency
  cancel would be missing from the counts above.
