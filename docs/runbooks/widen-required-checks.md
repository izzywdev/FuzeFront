# Runbook — widen master's required status checks (and the merge-queue prerequisite)

**Status:** ready to apply, needs repo-admin rights.
**Owner:** `@izzywdev` · **Measured:** 2026-08-27 · **Ruleset:** *Protect Master*, id `17974934`

Desired state lives in [`governance/required-status-checks.json`](../../governance/required-status-checks.json).

---

## 1. The problem

CLAUDE.md, under *Branch lifecycle*, says:

> The safety net is the gate set (`gate-ds-conformance`, `gate-frames-first`, `gate-authz`,
> `gate-identifier`, and the full CI matrix) — those are the production guard, not the human
> review step. A bot-authored, bot-approved PR that clears every gate ships to prod. This is
> deliberate.

That is the intent. It is not what the repo enforces. Measured against the live ruleset:

```
$ gh api repos/izzywdev/FuzeFront/rulesets/17974934 \
    --jq '.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks|length'
11
```

**11 of 45 checks are required.** `gate-authz` and `gate-identifier` — both named above as
the production guard — are **not** among them. Neither is any backend, integration or e2e
test suite, nor CodeQL, Snyk, Container Security Scan, `gate-toolchain`, `gate-version`,
`gate-pagination` or `gate-vacuous-check`.

This is not theoretical. `auto-merge.yml` arms `gh pr merge --auto --squash`, and GitHub's
auto-merge waits on **required** contexts only. So a PR merges — and, because master is
deploy-on-push, **deploys** — the moment those 11 pass, while everything else is still
running or already red.

It nearly happened on 2026-08-27: `github-actions[bot]` armed auto-merge on #836 while
`Build chat-service` was failing (`COPY --from=base /app/packages/feature-flags/node_modules`
— not found, i.e. a production image that could not be built). `Build chat-service` is not a
required context, so nothing would have stopped that merge.

## 2. What is safe to require, and what is not

A required check that does **not run on every PR** never gets created, so the PR sits
permanently at *"Expected — waiting for status to be reported"* with no red to look at and
nothing to re-run. `workspace-deps-check.yml`'s header documents this repo hitting exactly
that on 2026-08-23, on four sampled PRs. **So only unfiltered checks may be required.**

Audited every workflow's `on.pull_request` trigger:

| Group | Verdict |
|---|---|
| `harden-gate.yml` (16 `gate-*` jobs), `ci.yml`, `backend-tests.yml`, `billing-service-tests.yml`, `custom-hostname-client-tests.yml`, `e2e.yml`, `security.yml`, `workspace-deps-check.yml`, `gate-sealed-keys.yml` | **unfiltered** — safe to require |
| `gate-openapi-conformance.yml`, `gate-route-ownership.yml`, `image-reproducibility.yml`, `helm-validate.yml`, `gate-frames-first.yml`, `gate-frames-stamped.yml`, `gate-mcp-contract.yml`, `oidc-plumbing-e2e.yml` | **path-filtered** — requiring these as they stand would deadlock PRs |

`Generate SBOM` is excluded separately: it concludes `skipped` on every PR — a generator,
not a gate.

**This is worth reading twice: several of the most valuable gates are in the second row.**
`shipped code matches the frozen contract` — the check that would have caught
`config-service` shipping two declared-but-unimplemented endpoints — *cannot* be required
until its trigger is unfiltered. Step 4 below covers that.

### Health check before requiring anything

Every candidate, across all 20 open PRs at the time of measurement:

```
29 candidate contexts x 20 open PRs  ->  0 failures
```

No candidate was red anywhere, so widening the set stalls nothing already in flight.

## 3. Apply it (admin required)

CI cannot do this, and neither can an agent session: the rulesets API is write-blocked
through the agent proxy (`403 Write access to this GitHub API path is not permitted`). Run
this as a repo admin:

```bash
# Back up first — this PUT replaces the rules array wholesale.
gh api repos/izzywdev/FuzeFront/rulesets/17974934 > /tmp/ruleset-before.json

python3 - <<'PY'
import json, subprocess
BEFORE = json.load(open('/tmp/ruleset-before.json'))
WANT   = json.load(open('governance/required-status-checks.json'))['contexts']
for r in BEFORE['rules']:
    if r['type'] == 'required_status_checks':
        p = r['parameters']
        have = {c['context'] for c in p['required_status_checks']}
        # integration_id 15368 = GitHub Actions; every context here is Actions-produced.
        p['required_status_checks'] += [
            {"context": c, "integration_id": 15368} for c in WANT if c not in have
        ]
        p['required_status_checks'].sort(key=lambda c: c['context'])
payload = {k: BEFORE[k] for k in ('name','target','enforcement','conditions','rules') if k in BEFORE}
payload['bypass_actors'] = BEFORE.get('bypass_actors') or []
json.dump(payload, open('/tmp/ruleset-after.json','w'), indent=2)
PY

gh api -X PUT repos/izzywdev/FuzeFront/rulesets/17974934 --input /tmp/ruleset-after.json
```

Verify — the count must read 39, `strict` must stay `true`, and all four rule types must
survive (the PUT replaces the array, so a dropped `pull_request` rule would silently remove
the approval requirement):

```bash
gh api repos/izzywdev/FuzeFront/rulesets/17974934 \
  --jq '{n:(.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks|length),
         strict:(.rules[]|select(.type=="required_status_checks")|.parameters.strict_required_status_checks_policy)}'
gh api repos/izzywdev/FuzeFront/rulesets/17974934 --jq '[.rules[].type]'
```

**Rollback:** `gh api -X PUT repos/izzywdev/FuzeFront/rulesets/17974934 --input /tmp/ruleset-before.json`

## 4. Follow-up — unfilter the path-filtered gates, then require them

For each workflow in the second row of the table above: remove `paths:` from the
`on.pull_request` trigger and do the filtering **inside the job** instead. That is the same
correction `workspace-deps-check.yml` and `gate-sealed-keys.yml` already carry, and both
explain the reasoning in their own headers — *"filter INSIDE a job, never on the trigger,
for anything the ruleset requires."*

Then add those contexts to `governance/required-status-checks.json` and re-run step 3.

## 5. Merge queue — do NOT enable it yet

Merge queue is the right fix for a separate problem: `strict_required_status_checks_policy`
is `true` and master is deploy-on-push, so **every merge lands a release commit that puts
every other open PR behind**, costing a full CI matrix per PR per merge. A queue tests the
merged result and merges in order, which removes that treadmill entirely.

**It cannot be switched on as-is.** Two hard prerequisites, both verified 2026-08-27:

1. **No workflow in this repo has a `merge_group` trigger.** Audited all 58 PR-triggered
   jobs: zero. GitHub dispatches queue entries as `merge_group` events, so with no workflow
   listening, **no check ever reports on a queue entry** and every entry sits until it times
   out and is ejected. Enabling the queue in this state stops merges completely.

2. **Several required gates read PR context that a `merge_group` event does not have.**
   `gate-ds-conformance` ratchets on lines changed against the PR base; `gate-frames-first`
   reads the PR's changed files. Under `merge_group` there is no `github.event.pull_request`
   — the base is `github.event.merge_group.base_sha`. Adding the trigger without adapting
   those lookups gives green checks computed over an empty diff, which is worse than no
   queue: a vacuous gate that reports success.

**Order of work:** land `merge_group` support (trigger + base-ref handling) in every workflow
that provides a required context, prove a gate still FAILS on a violation under a
`merge_group` event, and only then enable the queue. Until that is done, serialize merges
(advance one PR at a time) — slower, but correct.
