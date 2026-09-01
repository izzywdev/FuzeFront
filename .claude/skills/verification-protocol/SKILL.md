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

## Verifying a DIAGNOSIS (not just your own output)

Everything above verifies *your artifact* — did the push land, does the PR exist. It does not
cover the more frequent failure: **a causal claim about system state, formed by inference and
reported as fact.** "The App lacks `workflows: write`." "CI is stuck on budget." "That repo was
never registered." "`Replace=true` recreates the resource." "No repo has migrated to self-hosted
runners." Each of those was wrong, and each was settled in seconds by an artifact that existed
at the time it was asserted.

**Rule: before reporting a cause, read the artifact that decides it.** When a cheap artifact
would settle the claim, reading it is not extra diligence — it *is* the claim's evidence. Without
it you have a hypothesis that you have described as a finding.

- **A plausible mechanism is not evidence.** A coherent account of *why* something behaves as it
  does feels like knowledge and is not. Coherence is the one thing a right diagnosis and a
  confident wrong one always share.
- **A subagent's report is a claim, not a result.** The done-contract obliges the agent to quote
  real output; it does not oblige *you* to accept the narrative wrapped around it. Read the quoted
  evidence or re-run the check — from a summary alone, an agent that verified and an agent that
  inferred are indistinguishable.
- **A search that finds nothing proves nothing until you show the search could have found it.**
  Grepping for a literal name that is not the name actually in use returns zero hits and is
  indistinguishable from real absence.
- **Read the instrument you already ran.** A probe is worthless until its output is read.
  Reporting a check as "still pending" without opening the completed run is this same error turned
  against your own diagnostic.
- **Cost asymmetry decides the order.** These checks cost seconds. A wrong causal report costs a
  round-trip, points work in the wrong direction, and spends the credibility of every other claim
  filed beside it. When the check is cheap, run it *before* reporting — not after being challenged.

**Report shape — always separate the three:** **verified** (artifact read; quote it), **inferred**
(say so, and name the check that would settle it), **unknown**. Labelling a claim inferred costs
nothing at the time; having the difference discovered downstream is what is expensive.
