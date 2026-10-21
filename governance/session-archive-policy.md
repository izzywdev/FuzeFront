# Session archive policy — "can this session be archived?"

Owner ruling 2026-10-14. Applies to every agent session working in any Fuze repo.
Canonical home: FuzeSDLC `governance/`; consuming repos receive it via governance-sync
(`scripts/governance_sync.py`, managed file at the same path).

## Rule

When the user asks whether a session can be **archived or closed** (the request must mention
archiving or closing; a plain "is this done?" status check is answered normally and archives
nothing), the agent does **not** answer with a "still open, but not here" list. It executes the
hand-off:

1. **Enumerate** every open item that does not belong in the current session: mirror/follow-up
   work in another repo, post-merge verification, deferred scope, anything the agent would
   otherwise have listed as "someone should…".
2. **Spawn one new session per item** (`create_session`, `source_url` = the repo that owns the
   item). First reuse: if a session for the item was already spawned earlier in this conversation
   (archiving was deferred and is being retried), link that session instead of creating a
   duplicate. Each prompt must stand alone: goal, files by repo-relative path, the PR/commit that
   motivated it, and what done looks like. Never include secrets.
3. **Show the spawned sessions** to the user as links (`https://claude.ai/code/<session_id>`),
   one line per item: what it covers and which repo it targets.
4. **Confirm each child accepted the hand-off** (`get_session` on each). Past pending counts as
   started (working, review-ready or already completed), but a child validates its hand-off
   against a *running* parent (`governance/cross-session-orchestration.md`) on its first turn,
   so poll each child a second time after a short interval. If any child is blocked or failed
   (it paused or rejected the hand-off), or has not left pending, say so and do not archive.
5. **Archive the current session** (`archive_session`) once the links are posted and every
   child has started, and no user question is unanswered (see below).

## Scope

Sessions that have the Claude Code Remote session tools (`create_session`, `get_session`,
`archive_session`). Where those tools are unavailable (other provider runtimes — the `openai`
and `hermes` adapters under `agent-templates/providers/` raise `NotImplementedError` for both
— or a delegation transport such as `spawn_agent`), do not improvise: list the items, name the
transport that would be needed, and leave archiving to the user.

## Preconditions (do these first, never skip)

- Any PR this session opened is merged or closed. If it is still open, drive it to a terminal
  state first; do not archive over a live PR, and do not spawn sessions to babysit it.
- Nothing is uncommitted or unpushed. Work that exists only on local disk is not archivable.
- Every branch this session created is merged or deleted, or has a PR that is merged or closed
  with its branch deleted (a closed-but-unmerged PR whose branch still exists is still flagged
  by the stranded-branch detector). A pushed branch with no PR is stranded: open its PR and
  drive it to a terminal state first (CLAUDE.md "Branch lifecycle policy").
- Defects found in this session's own scope are **fixed here** (see CLAUDE.md "FIX is the
  rule"); only out-of-scope, other-repo, or later-observation items are spawned.

## Not covered

- Items that need a decision only the user can make: put those in the reply as questions; do
  not spawn a session that would just stall on them, and do **not archive** while any such
  question is unanswered (an archived session is read-only until unarchived, so the user could
  not answer where the context lives). Spawn the rest and ask the question. After the answer,
  re-run the whole procedure (an answer can create new work to do here or to hand off) before
  archiving.
- Never edit another repo from the current session to save a spawn; delegate it.
- An answer of "nothing outstanding" is valid when the enumeration in step 1 is empty: archive
  and say so.

## Propagation

Policy authorship lives here; the one-paragraph summary is in `CLAUDE.baseline.md` §9
("Session archive"). `scripts/governance_sync.py` reconciles this file into every consuming
repo at `governance/session-archive-policy.md` on each run (canonical wins), so this copy is
the only one worth editing — a consuming repo that improves its own copy has that improvement
reverted on its next PR. The §Scope fallback and step 4 above arrived exactly that way: they
were written in FuzeFront, reverted twice by governance-sync, and are upstreamed here.
