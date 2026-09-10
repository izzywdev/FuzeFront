---
name: sync-and-drive-group
description: Fan out a "sync your branch and drive to completion" nudge to every Claude Code Remote session in a group — a repo/project (like the "[FuzeFront]" heading in the Claude Code sidebar) or an explicit list of session IDs — AND keep checking on them until each is done or genuinely stuck. Use whenever the user asks to sync, ping, nudge, wake up, or orchestrate a batch of sessions, or to "drive them to completion" rather than message them once — e.g. "sync and drive to completion all sessions in FuzeFront", "orchestrate the FuzeInfra sessions", "get every session on this repo mergeable", "wake the idle sessions under this project and don't leave them until they're done". Not for one already-running session (message it directly), or sessions outside this account. NOT fire-and-forget — the "Keep watching" section is the point, not an extra.
---

# Sync and drive a group of sessions to completion

## What "group" means here

The Claude Code sidebar groups sessions under a heading like "FuzeFront" or "FuzeInfra". That heading is **not** a local file or a folder concept — it's derived server-side from each session's own `session_context.sources[].git_repository.url` (recorded in the cloud when the session was created). There is no local desktop file to read for this; the only way to resolve "everyone in group X" is to list every session the account owns and filter by that field yourself. Keep this in mind if the user is surprised a session "isn't in the group" — it's whichever repo that session's `sources` say it is, not something manually curated.

## Why a normal message doesn't reach these sessions

`SendMessage`/`ListAgents` only reaches agents that are live right now (subagents, or other Claude Code sessions actively running on the same machine). Most sessions in a sidebar group are idle, pending, or archived — `ListAgents` won't even list them. The only mechanism that reliably wakes a *specific*, *existing* Claude Code Remote session and delivers a message into its own conversation (not a new one) is a poke-only Routine bound to it:

1. `mcp__Claude_Code_Remote__create_trigger` with `persistent_session_id` set to the target session's id, `initiation: "human_request"`, and **no** `cron_expression`/`run_once_at` (this makes it a one-shot "poke" that never fires on its own).
2. `mcp__Claude_Code_Remote__fire_trigger` on the trigger id it returns — this delivers the prompt into that session right now.
3. `mcp__Claude_Code_Remote__delete_trigger` on the same id afterward, to avoid leaving clutter in the user's Routines list. A "not found" error here is harmless (some backends auto-clean a fired one-shot) — don't treat it as a failure.

If an archived session needs pinging, `mcp__Claude_Code_Remote__unarchive_session` it first — an archived session is read-only and can't be fired into.

## Procedure

### 1. Resolve the group into a session list

Call `mcp__Claude_Code_Remote__list_sessions` with `mine: true`. Results are large (this account has had 100s of sessions) and will usually get written to a tool-result file rather than shown inline — that's expected. Parse that file with `scripts/parse_sessions.py` rather than eyeballing raw JSON:

```
python3 scripts/parse_sessions.py <tool-result-file> --repo <owner/repo-or-substring>
```

It prints one `id | title | status | repo` line per matching session. Repeat `list_sessions` with `after_id` set to the last id seen, and keep paginating (feeding each page's file through the script) until a page comes back empty or shorter than the page size — the account can easily have 100+ sessions, and the group you want is often not on page 1.

If the user gave explicit session IDs instead of a repo/group name, skip this step and use their list directly.

### 2. Filter out sessions you shouldn't ping

- Drop the calling session itself (check its own id via `mcp__Claude_Code_Remote__get_session` with no `session_id`, or from context).
- Drop `SESSION_STATUS_ARCHIVED` sessions **unless** the user asked to include archived ones — then `unarchive_session` each one first.
- If a title appears more than once (duplicate/stale sessions on the same task), prefer the non-archived, more-recently-updated one and mention the skipped duplicate in your final report rather than pinging both.

### 3. Ping every matched session, in parallel

For each session, send **one message with all three calls batched together** across all matched sessions (i.e. all the `create_trigger` calls in one tool-call batch, then all the `fire_trigger` calls once you have every trigger id, then all the `delete_trigger` calls) — not one session fully handled before starting the next. These sessions are independent of each other, so there's no reason to serialize.

Default prompt template (adapt the branch/PR specifics to what you know about the repo — e.g. this repo's own `CLAUDE.md` may mandate an `auto-merge` label, a specific default branch name, or a particular PR gate):

```
Orchestration ping: sync your branch from <repo>'s default branch (master, or main —
check which this repo uses) first, then drive this task to completion.

1. git fetch origin and merge/rebase the default branch into your working branch,
   resolving any conflicts.
2. Continue implementing/validating your task, commit, and push.
3. Open (or update) a non-draft PR [+ any repo-specific requirement, e.g. an
   auto-merge label] and make sure CI is green.
4. Once you reach a terminal state (PR merged/closed) or hit a genuine blocker
   only a human can resolve, report status.

Proceed autonomously.

(This message was delivered via a one-shot Routine that has already been fired and
deleted on our end — don't spend a turn trying to list, update, or delete any
trigger/Routine related to this ping, there's nothing left to manage.)
```

That last paragraph is not filler — leave it out and you'll reliably cause the exact failure mode described in "Keep watching" below: a session that finishes its actual work then goes looking for the Routine that woke it (to tidy it up) and gets stuck on a permission prompt for `list_triggers`/`update_trigger`/`delete_trigger` on a trigger that's already gone, wasting a turn on nothing.

Don't just copy this template verbatim without thinking — if the repo's own governance doc (CLAUDE.md, CONTRIBUTING.md) specifies a different branch-lifecycle or merge policy, follow that instead; the point of the message is to get the *right* sync-and-finish behavior for that repo, not to recite a fixed script.

### 4. Report back once, then keep watching

Give the user a short summary after the initial fan-out, not a wall of raw tool output — how many sessions were pinged and their titles, any skipped (archived-and-left-alone, duplicates, the calling session itself) and why, any that failed to trigger with the error. But **this is a status update, not the finish line** — see the next section.

## Keep watching — this is the actual job, not a bonus

Firing the ping and walking away is the failure mode this skill exists to prevent. "Drive to completion" means what it says: don't consider the group done until each session in it has reached a terminal state or you've surfaced a real blocker to the user. Concretely:

### Re-check periodically instead of trusting a fire-and-forget

A ping doesn't guarantee the target session acts on it promptly, or that a single nudge is enough — sessions get blocked, run into questions only a human can answer, or need a second round after a failed CI run. So don't stop after step 4. Set up a recurring check-in:

- If you can schedule a recurring wake for *yourself* (e.g. `mcp__Claude_Code_Remote__create_trigger` with a `cron_expression` and no `persistent_session_id` — that binds it to the calling session — or your harness's own periodic-wakeup mechanism), do that instead of trying to babysit synchronously. Something like every 30–60 minutes is reasonable; don't go tighter than the platform's minimum interval (typically hourly for cron Routines).
- Each check-in, call `mcp__Claude_Code_Remote__get_session` on every session you pinged (batched in parallel, one call per session — cheap and precise, cheaper than re-paginating `list_sessions`).
- Stop the recurring check-in once every session is in a terminal state (merged/closed PR, or explicitly handed to the user with nothing further you can do) — don't leave it running forever. If you can't schedule anything (no recurring-wake mechanism available in your environment), say so explicitly in your report rather than silently doing a single check and calling it done.

### Reading a session's status without re-reading its whole transcript

`get_session`'s response carries the signal you need without pulling the full conversation:

- `session_status` / `status_bucket` — `SESSION_STATUS_BUCKET_COMPLETED` or `REVIEW_READY` generally means nothing more is needed from you; `BLOCKED` or `SESSION_STATUS_REQUIRES_ACTION` means look closer.
- `external_metadata.post_turn_summary` (`status_category`, `status_detail`, `needs_action`, `recent_action`) — the session's own best summary of where it's at and what it's waiting on. Read `needs_action` first; it's usually a one-line answer to "is this session stuck, and on what."
- `external_metadata.pending_action` / `pending_actions` — a tool call the session is blocked waiting on a human to approve or deny *in the app*. You cannot approve or deny this via any API call available to you — there is no "approve pending action" tool. Don't re-ping a session in this state expecting the ping to unblock it; it won't clear a pending permission prompt. Instead:
  - If the pending tool call is `list_triggers`/`update_trigger`/`delete_trigger` and plausibly targets the very trigger *you* created for this ping (which you already deleted in step 3), that's a self-inflicted dead end from the target session trying to clean up after itself — see the note in step 3 about telling it not to bother. Mention it in your report as harmless but stuck-until-a-human-clicks-something; don't count it as real progress blocked.
  - Otherwise, it's a genuine decision (approving a plan via `ExitPlanMode`, or similar) — surface it to the user by name (which session, what it's asking) rather than guessing at an answer.
- `task_summary` (when present) — often the clearest single field: the session's own account of whether it finished, what's left, and why.

### What counts as "done" vs. "needs the user"

- **Done**: PR merged, branch cleaned up, or the session itself reports the task's terminal condition was met. No further action from you.
- **Needs the user, not you**: anything requiring a credential/secret you don't hold, a business/product judgment call (ship this UX? raise this issue? approve this plan?), manual verification only a human can do (e.g. "does the live site look right in your browser"), or an in-app permission click. Collect these and hand them to the user as a clear, short list — don't try to decide on the user's behalf, and don't silently drop them either (a blocker you noticed but didn't relay is worse than one you never checked for).
- **Needs another nudge from you**: a session that's genuinely idle/stalled with nothing pending and clearly more to do — re-run the same ping-and-fire procedure from step 3 for that one session only.

### Reporting to the user across check-ins

After the first fan-out, subsequent reports should be *deltas*, not full re-dumps: what changed since last time, what's newly done, what's newly stuck and needs the user's decision. If nothing changed since the last check-in, say so briefly rather than re-listing everything — this mirrors how the user experiences a `/loop`-style check-in and keeps a long-running orchestration legible instead of noisy.
