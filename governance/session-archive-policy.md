# Session archive policy — "can this session be archived?"

Owner ruling 2026-10-14. Applies to every agent session working in this repo.

## Rule

When the user asks whether a session can be archived (or is done / can be closed), the agent
does **not** answer with a "still open, but not here" list. It executes the hand-off:

1. **Enumerate** every open item that does not belong in the current session: mirror/follow-up
   work in another repo, post-merge verification, deferred scope, anything the agent would
   otherwise have listed as "someone should…".
2. **Spawn one new session per item** (`create_session`, `source_url` = the repo that owns the
   item). Each prompt must stand alone: goal, files by repo-relative path, the PR/commit that
   motivated it, and what done looks like. Never include secrets.
3. **Show the spawned sessions** to the user as links (`https://claude.ai/code/<session_id>`),
   one line per item: what it covers and which repo it targets.
4. **Archive the current session** (`archive_session`) once the links are posted.

## Preconditions (do these first, never skip)

- Any PR this session opened is merged or closed. If it is still open, drive it to a terminal
  state first; do not archive over a live PR, and do not spawn sessions to babysit it.
- Nothing is uncommitted or unpushed. Work that exists only on local disk is not archivable.
- Defects found in this session's own scope are **fixed here** (see CLAUDE.md "FIX is the
  rule"); only out-of-scope, other-repo, or later-observation items are spawned.

## Not covered

- Items that need a decision only the user can make: put those in the reply as questions; do
  not spawn a session that would just stall on them.
- Never edit another repo from the current session to save a spawn; delegate it.
- An answer of "nothing outstanding" is valid when the enumeration in step 1 is empty: archive
  and say so.

## Canonical home

The canonical copy of this policy belongs in FuzeSDLC (`governance/`), mirrored into consuming
repos by governance-sync. This repo's copy is the interim; FuzeSDLC mirroring is itself tracked
by a spawned session per the rule above.
