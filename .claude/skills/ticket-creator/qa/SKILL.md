---
skill: ticket-creator/qa
version: 1.0
---

# QA Task Creator (Router)

## Purpose
Routes to the correct QA sub-type skill based on the type of test being created.

## Routing Table
| Test Type | Sub-skill |
|-----------|-----------|
| Unit | `unit/SKILL.md` |
| Functional / E2E | `functional/SKILL.md` |
| Integration | `integration/SKILL.md` |
| Load Test / Stress Test / Performance | `load-stress/SKILL.md` |
| Security / Penetration / OWASP | `security/SKILL.md` |

## If test type is unclear
Ask: "What type of QA task? (Unit / Functional / Integration / Load-Stress / Security)"

## Universal QA rules
- Story Points must be in {2, 4, 8}. Unit tests: 2–4 pts. Functional: 4–8 pts. Load/Security: 4–8 pts.
- Assignee for Unit tests = the developer who built the feature (not the QA engineer)
- Environment: Unit = any; Functional/Integration = Staging; Load/Security = Staging only, NEVER Production
