---
skill: ticket-reviewer/story
---

# Story Reviewer

## Review Checklist

Apply universal fields from `../SKILL.md`, then:

| Section | Green ✅ | Yellow 🟡 | Red 🔴 |
|---------|---------|---------|------|
| Parent Epic | Linked to an Epic | — | Not linked |
| User Story format | As a [persona] / I want / So that — all 3 parts present | Present but vague persona ("user" / "admin") | Missing or not in this format |
| Acceptance Criteria | ≥ 2 Given/When/Then items + ≥ 1 edge case + ≥ 1 error case | ≥ 2 items but no edge/error case | < 2 items or no AC at all |
| Definition of Done | ≥ 5 of 7 standard items present | 3–4 items | < 3 items |
| Sub-Tasks | ≥ 1 dev task (BE or FE) + ≥ 1 QA task | ≥ 1 task total | No sub-tasks |
| Story Points | Set, equals sum of sub-task points from {2,4,8} | Set but doesn't match sub-task sum | Not set |
| Story integration branch | `story/<KEY>-<slug>` exists; draft PR targets default branch; child task PRs target Story branch | Branch exists but PR/base links are incomplete | Missing or child PRs target default directly |
| Sprint | Assigned (if status ≠ Backlog) | — | In Progress but no sprint |
| References | Figma link present (if FE work involved) | — | No refs if design exists |

## Sizing check
Load `../../shared/templates/SIZING.md`.
Check: if critical path of sub-tasks (longest sequential chain per developer) > W=10 days, flag:
"⚠️ Story may exceed 1 sprint. Suggest splitting at: [point where it could be split]."

## Output
Use the format from `../SKILL.md`.
