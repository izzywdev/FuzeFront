---
name: ticket-reviewer
description: Review a single existing Jira ticket for completeness and quality, returning a structured score with gap analysis and concrete improvement suggestions. Use to assess/improve one Jira ticket.
skill: ticket-reviewer
version: 1.0
project: FuzePlan / PhoneDo
---

# Ticket Reviewer (Router)

## Purpose
Reviews an existing ticket for completeness and quality.
Returns a structured score with gap analysis and concrete improvement suggestions.

## Input
Ticket content (from Jira via MCP fetch, or pasted text).
If fetching from Jira, retrieve: summary, description, issuetype, status, assignee, priority, labels, parent, story points.

## Routing Table
| Ticket Type | Sub-skill |
|-------------|-----------|
| Epic | `epic/SKILL.md` |
| Story | `story/SKILL.md` |
| Frontend Development / Backend Development / Sub-task | `dev-task/SKILL.md` |
| QA Task (any sub-type) | `qa/SKILL.md` |
| Documentation | `docs/SKILL.md` |
| DevOps Task | `devops/SKILL.md` |
| Bug | `bug/SKILL.md` |
| UX Task | `dev-task/SKILL.md` (uses same review structure as dev tasks) |

## Universal Fields (check on ALL ticket types)
| Field | Green ✅ | Yellow 🟡 | Red 🔴 |
|-------|---------|---------|------|
| Summary | Action verb + specific outcome | Vague but present | Missing or just ticket type name |
| Assignee | Set | — | Unassigned + not in Ideation/Backlog |
| Priority | Set | — | None / not set |
| Description | Present and > 100 chars | Present but < 100 chars | Empty |

## Output Format
```
## Review: [TICKET-ID] — [Ticket Type]

**Overall: 🟢 Strong / 🟡 Needs work / 🔴 Incomplete**

| Section | Score | Gap |
|---------|-------|-----|
| [Field] | 🟢/🟡/🔴 | [Issue or —] |
...

### ⚠️ Required before moving to next status
1. [Specific fix required]
2. [Specific fix required]

### 💡 Suggested improvements
- [Optional improvement]
```

## Scoring logic
- 🟢 Green: 0 red + ≤ 1 yellow → **Strong**
- 🟡 Yellow: 0 red + 2–3 yellows → **Needs work**
- 🔴 Red: any red OR 4+ yellows → **Incomplete**
