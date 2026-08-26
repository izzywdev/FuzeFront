---
skill: ticket-reviewer/bug
---

# Bug Reviewer

## Review Checklist

Apply universal fields from `../SKILL.md`, then:

| Section | Green ✅ | Yellow 🟡 | Red 🔴 |
|---------|---------|---------|------|
| Severity | Set (Critical / High / Medium / Low) | — | Not set |
| Summary | States what's broken + business impact in 1 sentence | Vague impact | Just "bug in X" |
| Steps to Reproduce | ≥ 3 numbered steps, specific enough to reproduce | ≥ 2 steps but vague | < 2 steps or missing |
| Expected vs Actual | Both present, each ≥ 20 chars and specific | One missing or vague | Both missing |
| Environment Details | Browser/Client + User Role + URL present | 1–2 fields present | Missing |
| Evidence | ≥ 1 item checked (screenshot / Sentry / logs) | — | All unchecked |
| Parent (Epic or Story) | Linked to Epic or Story | — | Not linked |
| Bug rules | Correct placement per BUG_RULES.md | — | Bug under wrong parent |

## Severity SLA check
Load `../../shared/templates/SIZING.md`.
Check assignment SLA: if Severity=Critical and Assignee is empty or bug is in Opened status for > 4h, flag: "⚠️ Critical bug SLA breach risk."

## Spawn sub-tasks check
If the bug has been In Progress for a while but has no sub-tasks and the fix is non-trivial, suggest:
"💡 This fix appears to require significant work. Consider spawning sub-tasks per BUG_RULES.md."

## Output
Use the format from `../SKILL.md`.
