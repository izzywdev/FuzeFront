---
skill: ticket-reviewer/qa
---

# QA Task Reviewer (all sub-types)

## Purpose
Reviews QA Tasks of any sub-type: Unit, Functional, Integration, Load/Stress, Security.
The review structure is the same — only the type-specific checks differ.

## Review Checklist

Apply universal fields from `../SKILL.md`, then:

| Section | Green ✅ | Yellow 🟡 | Red 🔴 |
|---------|---------|---------|------|
| Test Type | Explicitly stated (Unit/Functional/Integration/Load-Stress/Security) | — | Missing |
| Parent Story | Linked | — | Not linked |
| Story Points | In {2, 4, 8} | — | Not set |
| What to Test | 1–2 sentences, specific | Vague but present | Missing |
| Test Scenarios | ≥ 1 table with ≥ 3 rows (Happy + Edge + Error) | ≥ 1 row present | No scenarios |
| Acceptance Criteria | ≥ 2 specific, verifiable items | 1 item | Missing |
| Environment | Explicitly stated | — | Missing |
| Tool | Named (Jest / Cypress / k6 / ZAP / etc.) | — | Missing |

## Unit-specific
- Assignee must be the developer (not a QA engineer) → flag if it appears to be a QA engineer
- Coverage requirement must be stated

## Load/Stress-specific
- Performance targets table must be present with ≥ 4 metrics
- All 4 scenarios (Baseline / Peak / Stress / Spike) must be present
- Environment note "Staging only — NOT Production" must be explicit

## Security-specific
- OWASP checklist must be present (all 10 rows)
- Feature-specific test cases must include at minimum: auth bypass + IDOR

## Output
Use the format from `../SKILL.md`.
