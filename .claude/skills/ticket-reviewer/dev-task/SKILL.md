---
skill: ticket-reviewer/dev-task
---

# Dev Task Reviewer (Frontend · Backend · UX · DevOps)

## Purpose
Reviews Frontend Development, Backend Development, UX Task, and DevOps Task sub-tickets.
These share the same review structure (implementation tasks + ACs + testing).

## Review Checklist

Apply universal fields from `../SKILL.md`, then:

| Section | Green ✅ | Yellow 🟡 | Red 🔴 |
|---------|---------|---------|------|
| Parent Story | Linked to a Story | — | Not linked |
| Story Points | In {2, 4, 8} | — | Not set or invalid value |
| Context | ≥ 1 sentence explaining what + why | Present but < 30 chars | Missing |
| Implementation Tasks | ≥ 4 specific, actionable items | 2–3 items or vague | < 2 items |
| Acceptance Criteria | ≥ 3 specific, verifiable items | 1–2 items | Missing |
| Testing Requirements | ≥ 2 specific test cases (named) | "write unit tests" (generic) | Missing |
| References | Parent story + Figma (if FE/UX) | One ref missing | No refs |

## Backend-specific checks
| Section | Green ✅ | Red 🔴 |
|---------|---------|------|
| API Specification | Method, path, auth, request body, response, errors all present | Any of these missing |
| DB Changes | Explicitly stated (even if "No DB changes") | Not mentioned |
| Business rule | At least 1 explicit business rule in ACs | ACs are only technical (no business logic) |

## Frontend-specific checks
| Section | Green ✅ | Red 🔴 |
|---------|---------|------|
| Figma link | Present | Missing (for any FE task) |
| All 4 states | Loading/Error/Empty/Populated in ACs | Any state missing |

## UX-specific checks
| Section | Green ✅ | Red 🔴 |
|---------|---------|------|
| Required states | All 7 states listed | < 5 states |
| Deliverables | Wireframes + HiFi + handoff noted | Only "design the screen" |

## DevOps-specific checks
| Section | Green ✅ | Red 🔴 |
|---------|---------|------|
| Rollback Plan | Trigger + steps present | Missing |
| Security checklist | All 4 items present | Missing |

## Output
Use the format from `../SKILL.md`.
