---
name: ticket-enforcer
description: Audit a whole Jira project or sprint for ticket-quality compliance in bulk, producing per-ticket scores and a project-level health summary. Use to enforce Jira ticket quality across many tickets.
skill: ticket-enforcer
version: 1.0
project: FuzePlan / PhoneDo
---

# Ticket Enforcer

## Purpose
Audits an entire project or sprint for ticket quality compliance.
Applies the same completeness rules as the ticket-reviewer to every ticket in bulk.
Produces an aggregate compliance report with per-ticket scores and a project-level health summary.

## Input
- A Jira project key (e.g., `BLNG`) — audits all open tickets
- OR a sprint name + project key — audits all tickets in that sprint
- OR a comma-separated list of ticket IDs — audits those specific tickets

## Step 1 — Fetch tickets
Use the Atlassian MCP tool to fetch tickets.

**For a project audit:**
```
JQL: project = [PROJECT_KEY] AND status != Closed ORDER BY issuetype ASC
Fields: summary, description, issuetype, status, assignee, priority, labels, parent, story_points, created, updated
```

**For a sprint audit:**
```
JQL: project = [PROJECT_KEY] AND sprint = "[SPRINT_NAME]"
Fields: same as above
```

Fetch in batches of up to 50. Continue paginating until all tickets are retrieved.

## Step 2 — Group by type
Group tickets into these categories:
- **Epic** — Epic type
- **Story** — Story type
- **Dev Task** — Frontend Development, Backend Development, UX Task, Sub-task
- **QA Task** — Any QA or Testing type
- **Documentation** — Documentation type
- **DevOps Task** — DevOps type
- **Bug** — Bug type
- **Unknown** — Anything not in the above list (flag for type cleanup)

## Step 3 — Apply rules per ticket

### Universal rules (all types)
| Check | Green ✅ | Yellow 🟡 | Red 🔴 |
|-------|---------|---------|------|
| Summary | Verb + specific outcome | Vague but present | Missing or just type name |
| Assignee | Set | — | Unassigned (if not Backlog/Ideation) |
| Priority | Set | — | None |
| Description | > 100 chars | > 30 chars | Empty or < 30 chars |

### Epic-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Problem Statement | Present and > 50 chars | Missing |
| Goal | Present | Missing |
| Features In Scope | ≥ 3 items | < 3 or missing |
| Success Metrics | ≥ 1 metric with target | Missing |
| Child Stories | ≥ 1 story linked (if past Ideation) | None linked + not in Ideation |
| Sizing | Duration ≤ N×D = 84 days | > 84 days in progress |

### Story-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Parent Epic | Linked | Not linked |
| User Story format | All 3 parts present | Missing or incomplete |
| Acceptance Criteria | ≥ 2 Given/When/Then | < 2 or no AC |
| Definition of Done | ≥ 5 items | < 3 items |
| Sub-Tasks | ≥ 1 dev + ≥ 1 QA | None |
| Story Points | Set and valid {2,4,8} sums | Not set or invalid |
| Sprint (if In Progress) | Assigned | Missing |

### Dev Task-specific rules (Frontend / Backend / UX / Sub-task)
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Parent Story | Linked | Not linked |
| Story Points | In {2, 4, 8} | Not set or invalid |
| Implementation Tasks | ≥ 4 items | < 2 items |
| Acceptance Criteria | ≥ 3 items | Missing |
| Testing Requirements | ≥ 2 named tests | Missing |
| Backend: API Spec | Method + path + response present | Missing |
| Frontend: Figma link | Present | Missing |

### QA Task-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Test Type | Stated | Missing |
| Story Points | In {2, 4, 8} | Not set |
| Test Scenarios | ≥ 3 rows (Happy + Edge + Error) | Missing |
| Environment | Stated | Missing |
| Load/Stress: Perf targets | All 6 metrics present | Missing |
| Security: OWASP checklist | All 10 rows present | Missing |

### Documentation-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Doc Type | Stated | Missing |
| Audience | Named | Missing |
| Deliverables | ≥ 1 document with location | Missing |
| Acceptance Criteria | ≥ 3 items | Missing |

### DevOps Task-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Environment | Stated | Missing |
| Rollback Plan | Trigger + steps | Missing entirely |
| Security Checklist | All 4 items | Missing |
| Implementation Tasks | ≥ 4 specific steps | < 2 or vague |

### Bug-specific rules
| Check | Green ✅ | Red 🔴 |
|-------|---------|------|
| Severity | Set | Not set |
| Steps to Reproduce | ≥ 3 steps | < 2 or missing |
| Expected + Actual | Both present > 20 chars | Either missing |
| Evidence | ≥ 1 item attached | All unchecked |
| Severity SLA | Assignee set within SLA window | Critical bug unassigned |

## Step 4 — Score each ticket
For each ticket:
- 🟢 **Green**: 0 red flags + ≤ 1 yellow flag
- 🟡 **Yellow**: 0 red flags + 2–3 yellow flags
- 🔴 **Red**: ≥ 1 red flag OR ≥ 4 yellow flags

## Step 5 — Generate compliance report

Output the report in this format:

```
# Ticket Compliance Report
**Project:** [PROJECT_KEY]   **Sprint / Scope:** [SPRINT or "All open tickets"]
**Run date:** [YYYY-MM-DD]   **Total tickets audited:** [N]

---

## Summary
| Score | Count | % |
|-------|-------|---|
| 🟢 Green | N | X% |
| 🟡 Yellow | N | X% |
| 🔴 Red | N | X% |

**Project health:** 🟢 Healthy / 🟡 Needs attention / 🔴 Action required

---

## 🔴 Red Tickets (fix before next sprint)
| Ticket | Type | Summary | Issues |
|--------|------|---------|--------|
| [ID] | [Type] | [Summary] | [Comma-separated list of red flags] |
...

## 🟡 Yellow Tickets (improve before moving to next status)
| Ticket | Type | Summary | Suggestions |
|--------|------|---------|-------------|
| [ID] | [Type] | [Summary] | [Comma-separated list of yellow flags] |
...

## 🟢 Green Tickets
[N] tickets are complete and well-formed. ✅

---

## Systemic Issues
[If ≥ 30% of tickets of the same type share a common gap, call it out here as a pattern.]
Example: "8 of 11 Stories are missing edge cases in Acceptance Criteria. Consider a story-writing session."

---

## Recommended Actions
1. [Most impactful fix, assigned to a team role]
2. [Second most impactful fix]
3. [Third]
```

## Notes
- This skill reads data; it does NOT modify any Jira tickets.
- If a ticket type cannot be identified, include it in an "Unknown Type" section and suggest setting the correct issue type.
- Apply bug placement rules from `../shared/templates/BUG_RULES.md` when reviewing Bug tickets.
- Apply sizing rules from `../shared/templates/SIZING.md` for Epic duration and Story point validation.
