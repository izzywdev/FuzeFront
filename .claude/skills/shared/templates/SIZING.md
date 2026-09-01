# SDLC Sizing Parameters

## Variables
| Parameter | Value | Meaning |
|-----------|-------|---------|
| **N** | 6 | Max sprints per Epic |
| **D** | 14 | Calendar days per sprint |
| **W** | 10 | Work days per sprint (Mon–Fri or Sun–Thu) |
| **H** | 8 | Work hours per day |
| **Sprint capacity** | W × H = 80h | Dev hours per developer per sprint |

## Epic Constraints
- Max duration: **N × D = 84 calendar days = 60 work days**
- An Epic that cannot close within N sprints must be decomposed into smaller Epics before it starts.

## Story Constraints
- Must be completable within **1 sprint (W = 10 work days, 80 dev-hours per developer)**.
- Cannot cross a sprint boundary.
- If oversized → split into 2+ stories **before** moving to In Progress. Never split mid-sprint.
- **Critical path rule:** the longest sequential chain of sub-tasks assigned to a single developer must be ≤ W days. Tasks worked in parallel by different developers (e.g., Frontend + Backend simultaneously) do not accumulate on the same critical path.

## Sub-task Story Points
- **Valid values: {2, 4, 8} only.** No 1s, 3s, 5s, 6s, 10s, or any other number.
- A 3-point estimate means the estimator cannot decide — that is a signal to clarify scope, not to use an in-between value.
- **1 point = 1 hour of focused work.**
  - 2 pts = 2 hours = ¼ work day
  - 4 pts = 4 hours = ½ work day
  - 8 pts = 8 hours = 1 full work day
- Developer daily capacity: 1–4 sub-tasks per 8h day (depending on size mix).

## Bug Sizing
- Same sprint constraint as Story: fix must close within 1 sprint.
- If the fix exceeds 1 sprint → escalate to a new Epic (it is a design defect, not a bug).

## Bug Severity SLAs
| Severity | Assignment SLA | Fix Target |
|----------|---------------|-----------|
| Critical | Within 4 business hours | Current sprint |
| High | Within 1 business day | Current sprint |
| Medium | Within 1 week | Current or next sprint |
| Low | At next sprint planning | Scheduled with PM |
