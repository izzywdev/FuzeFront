---
name: verification-protocol
description: Use before claiming any code/PR work is done. The push/PR verification discipline every code-producing agent follows: confirm the remote SHA, confirm the PR via API, and report the honest done-contract.
---

# verification-protocol

Evidence before assertions. Never claim done from local state alone.

## Steps
1. **Environment sanity** — confirm you are in the right repo/branch (`git remote -v`, `git rev-parse --abbrev-ref HEAD`).
2. **Push is real** — after pushing, confirm the remote moved: `git ls-remote origin <branch>` shows your new SHA (not the local ref).
3. **PR is real** — confirm via API, not a guessed URL: `gh pr view <n> -R <owner/repo> --json url,state,headRefOid`.
4. **Checks** — `gh pr checks <n>` / `gh run view` for the actual conclusions; quote them.
5. **Signatures** — for protected repos, confirm the merge/commit is `verified` (`gh api repos/<r>/commits/<sha> --jq .commit.verification.verified`).

## Done-contract (mandatory output)
`SCOPE DONE (verified): <commands run + their real output>` and `OUT OF SCOPE — NOT DONE: <named sibling layers you did not build>`. A failing result reported honestly is a valid deliverable; a green claim you did not verify is not.

## Verification under the model cascade

When work runs through the tiered cascade (`model-cascade` skill / `governance/model-cascade.md`):

- **Verification flows up, never down.** A parent verifies each child against the spec it handed down; a child never self-certifies. **A lower tier never grades a higher tier's work** — verification only moves up the tree (or sideways to an independent equal/higher lane).
- **The completeness verdict is a fresh, higher tier.** The final "is the whole thing done" pass is an independent **Opus** run on **fresh context**, returning **PASS / GAPS / FAIL** against the *original* scope. It is *additional* to this push/PR discipline, the CI Harden Gate, and the QA lanes — not a substitute for any of them. Only the orchestrator declares the *feature* done.
- **`ESCALATE:` vs `BLOCKED:`.** A node that exceeds its tier returns **`ESCALATE: <reason>`** — the **up-a-tier** (machine) sibling of **`BLOCKED: <question>`**, which reaches a **human** for a decision/credential/input. Never guess past your competence (`ESCALATE`); never stall an async run waiting on a human (push, then `BLOCKED`).
