---
skill: ticket-reviewer/devops
---

# DevOps Task Reviewer

## Review Checklist

Apply universal fields from `../SKILL.md`, then:

| Section | Green ✅ | Yellow 🟡 | Red 🔴 |
|---------|---------|---------|------|
| Environment | Explicitly stated (Dev / Staging / Production) | — | Missing |
| Risk Level | Stated (Low / Medium / High) | — | Missing |
| Planned Window | Date and time stated | — | Missing for Production changes |
| Implementation Tasks | ≥ 4 runbook-style steps (specific commands or actions) | 2–3 steps | < 2 or just "deploy the service" |
| Configuration Changes | Before/after config shown | Mentioned but no detail | Missing if change exists |
| Pre-deployment Checklist | ≥ 4 of 5 items checked | 2–3 items | Missing |
| Rollback Plan | Trigger + ≥ 2 steps present | Steps without trigger | Missing entirely |
| Security Checklist | All 4 items present | 2–3 items | Missing |
| Acceptance Criteria | Health check + monitoring criteria stated | Only "it works" | Missing |

## Output
Use the format from `../SKILL.md`.
