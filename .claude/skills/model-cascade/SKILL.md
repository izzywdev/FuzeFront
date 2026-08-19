---
name: model-cascade
description: Use when executing large-scoped work (multi-file / multi-slice / epic / audit / migration, or anything needing a plan) to run it through the tiered cascade — Opus decomposes into a task tree with per-node tiers, each leaf runs on the cheapest adequate tier (Haiku mechanical / Sonnet scoped / Opus judgment), tiers ESCALATE up rather than guess, parents verify children, and a fresh Opus pass gives the PASS/GAPS/FAIL completeness verdict. Skip it for small atomic tasks (run single-tier). Policy: governance/model-cascade.md.
---

# model-cascade

The executable protocol for **capability-routed tiered execution**. Run large-scoped work through it; run small atomic tasks single-tier (no decomposition). Full policy + rubric: `governance/model-cascade.md`.

> **Tier is HOW, scope is WHO — orthogonal.** Choosing a tier never changes who owns the deliverable. A domain agent keeps its scope boundary (`routing.md`) regardless of which model runs the call.

## The procedure — decompose → delegate → assemble → verdict

1. **Decompose (Opus).** Turn the work into a **task tree**. For each node, write a **hand-down spec** (template below) and assign a tier via the decision checklist.
2. **Delegate (down the tiers).** Run each node at its tier. Sonnet may sub-decompose mechanical leaves to Haiku. A node beyond its tier returns `ESCALATE: <reason>` and is re-run **one tier up**.
3. **Assemble (bottom-up).** Each parent integrates its children and **verifies their output against the spec it handed down**. A child never self-certifies; a lower tier never grades a higher tier's work. Integration conflicts escalate up.
4. **Verdict (Opus, fresh context).** Grade the assembled whole against the **original** scope → **PASS / GAPS(list) / FAIL**. Separate from the CI Harden Gate and the QA lanes — an additional orchestration gate. Only the orchestrator declares the *feature* done.

## The hand-down spec template (the micro-contract for every node)

```
NODE: <short name>
- Objective:           <what this node must produce, one sentence>
- Inputs:              <files / contract / prior outputs it is given>
- Constraints:         <rules it must not violate; scope boundary; what NOT to touch>
- Acceptance criteria: <explicit, testable "done" — no "use your judgment">
- Machine-check:       <the exact test/type/lint/schema command that proves it>
- Tier:                <opus | sonnet | haiku>  (per the decision checklist)
```

A node is not ready to delegate until every field is filled. If the spec would be as long as just doing the task, **don't decompose** — run it on the resident tier (anti-over-cascade).

## The decision checklist (route to the lowest adequate tier)

Pick the **lowest** tier whose gate is fully satisfied; re-evaluate on escalation.

- **Haiku** only if **ALL**: fully specifiable (zero judgment) · self-contained (one file / small known set, no cross-system inference) · mechanical/pattern-application · machine-checkable · **bounded blast radius** (never security/authZ, payment, data-migration, public-contract, or cross-repo).
- **Sonnet** when: scoped but needs synthesis (implement a slice vs a frozen contract, wire several files, unit tests, ordinary debugging) **or** sub-decompose+verify Haiku leaves; acceptance criteria clear, path chooses among known patterns.
- **Opus** when **ANY**: high ambiguity / design / cross-system judgment · high blast radius or irreversible · novel (no pattern) · the final completeness verdict.

> **Blast-radius override (negative test):** a security/authZ, payment, migration, public-contract, or cross-repo node is **Opus even if it looks small/mechanical**. Blast radius beats specifiability — never route such a node to Haiku.

## ESCALATE (the up-a-tier primitive)

- **`ESCALATE: <reason>`** — "this task exceeds my tier." The parent **re-classifies** the node and re-runs it **one tier up**. A tier never guesses past its competence.
- Distinct from **`BLOCKED: <question>`** — that reaches a **human** for a decision/credential/input. Inside an async run, never stall: push what you have, then `ESCALATE:` (machine, up a tier) or `BLOCKED:` (human).

## Reference Workflow scaffold (the deterministic encoder)

The Workflow tool encodes the cascade so it runs the same way every time. Sketch:

```js
// Phase 1: Opus decomposes large-scoped work into a typed task tree (per-node tier).
const tree = await agent({
  model: "opus",
  effort: "high",
  prompt: `Decompose this scope into a task tree. For each leaf emit the hand-down spec
           (objective, inputs, constraints, acceptance criteria, machine-check) and a tier
           in {haiku, sonnet, opus} per the model-cascade rubric. SCOPE:\n${scope}`,
  schema: TaskTreeSchema, // { nodes: [{ id, parent, spec, tier }] }
});

const TIERS = ["haiku", "sonnet", "opus"];
const upOne = (t) => TIERS[Math.min(TIERS.indexOf(t) + 1, TIERS.length - 1)];

// Phase 2: run each leaf at node.tier; ESCALATE re-runs it one tier up (re-classified).
async function runNode(node) {
  let tier = node.tier;
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await agent({ model: tier, prompt: renderSpec(node.spec) });
    if (!out.text.startsWith("ESCALATE:")) return { node, tier, out };
    tier = upOne(tier); // climb the ladder; never guess past competence
  }
  return { node, tier, escalatedToHuman: true }; // exhausted → BLOCKED to a human
}
const results = await pipeline(leaves(tree), runNode);

// Phase 3: assemble bottom-up — each parent verifies its children vs the handed-down spec.
//          (a child never self-certifies; a lower tier never grades a higher tier.)
const assembled = await assembleAndParentVerify(tree, results);

// Phase 4: fresh Opus completeness verdict vs the ORIGINAL scope (separate from CI + QA).
const verdict = await agent({
  model: "opus",
  effort: "high",
  freshContext: true,
  prompt: `Grade this assembled work against the ORIGINAL scope. Return PASS, GAPS(list),
           or FAIL with reasons. SCOPE:\n${scope}\nWORK:\n${summarize(assembled)}`,
  schema: VerdictSchema, // { verdict: "PASS"|"GAPS"|"FAIL", gaps?: string[] }
});
```

## Commit-trailer rule (auditability)

Fill the standing trailer with the **actual** tier that produced the commit, so git history shows which tier did what:

```
Co-Authored-By: Claude <Tier X.Y> <noreply@anthropic.com>
Claude-Session-Id: <session id>
```

e.g. `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` for a Sonnet-produced commit, `Claude Haiku 4.5` for a delegated mechanical leaf, `Claude Opus 4.8` for a decomposition/verdict commit.

## Done

Report per the `verification-protocol` skill: `SCOPE DONE (verified): …` + `OUT OF SCOPE — NOT DONE: …`. A node's verdict belongs to its parent; the *feature* verdict belongs to the orchestrator's fresh Opus pass — never to a single tier.
