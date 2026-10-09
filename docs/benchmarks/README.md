# Benchmarks

The Software Factory thesis (`docs/SOFTWARE_FACTORY.md`, `ROADMAP.md` §4 "The
Software Factory model compounds") is an empirical claim: onboarding a second
application onto FuzeFront should cost materially less than onboarding the
first, because the platform — not tribal knowledge — carries the reusable
work forward.

That claim is falsifiable, and until now nothing in this repository measured
it. This directory holds the benchmark that does: a specification for what to
measure, how to run it, and a template for publishing a result so different
runs are comparable.

- [`app-onboarding-benchmark.md`](app-onboarding-benchmark.md) — the
  specification: what is measured, what is explicitly out of scope, and the
  reproducible procedure.
- [`results-template.md`](results-template.md) — copy this to record one run.
- [`results/`](results/) — published runs, one file per run (see that
  directory's `README.md` for the naming convention).

## Why this lives here and not in `ADOPTION_QUICKSTART.md`

`docs/ADOPTION_QUICKSTART.md` already asks evaluators to informally note "time
to first successful local run" and "whether a second application becomes
materially easier than the first" under **What success looks like**. That
section is useful but not a benchmark: it has no fixed step boundaries, no
distinction between what counts as a "manual" step, and no shared template, so
two people running it produce anecdotes that cannot be compared or aggregated.
This benchmark gives that existing ask a precise, repeatable form. The
quickstart still points here for anyone who wants to turn their evaluation
into a comparable, publishable result.

## Ground rule: no invented numbers

This specification intentionally ships with **no baseline results file**. Any
number in a published result must come from someone actually executing the
procedure below and recording what happened, including failures — not from
estimating what the procedure "should" take. A results file that cannot name
the commit SHA and environment it was run against is not a valid benchmark
result; see the template for the required fields.
