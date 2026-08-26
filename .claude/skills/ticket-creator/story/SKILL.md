---
skill: ticket-creator/story
---

# Story Creator

## Purpose
Creates a complete, Jira-ready Story ticket from a brief description.

## Sizing check (before creating)
Load `../../shared/templates/SIZING.md`.
A Story must fit within 1 sprint (W=10 work days). Check the critical path of described sub-tasks.
If scope is clearly > 1 sprint, warn: "This story may need to be split. I'll generate it, but flag sub-tasks
that should become a separate story."

## Required information — ask if missing
1. **What does the user want to achieve?** (1-sentence user need)
2. **Who is the user?** (persona: admin / partner / business / agent)
3. **Which Epic does this belong to?** (Epic ID or description)

## Template
Load the template from `../../shared/templates/story.md` and fill it.

## Field guidance

### Title
Format: User-goal sentence — "Partner can view consolidated invoice for all managed businesses"
NOT task-format — "Create invoice endpoint" belongs in a sub-task, not the story title.

### User Story (As a / I want / So that)
- "As a" = specific persona (not "As a user")
- "I want to" = the action, not the implementation
- "So that" = the business or user benefit

### Acceptance Criteria
- Minimum 2 Given/When/Then items — always
- Must include at least 1 edge case and 1 error case
- Format strictly: "**Given** X **When** Y **Then** Z"
- No vague criteria: "Then the system works correctly" is not acceptable

### Story Points
- = sum of all sub-task story points
- Each sub-task must be 2, 4, or 8 points
- Calculate after listing sub-tasks

### Sub-Tasks
- List every implementation task as a typed sub-task (UX / Backend / Frontend / QA / Docs)
- Assign realistic story points from {2, 4, 8} to each
- At minimum include: at least 1 dev task (BE or FE) + at least 1 QA task

### Definition of Done
- Include all 7 standard DoD items from the template
- Add domain-specific items if the user mentions them (e.g., "needs partner notification")

## Output rules
- Output the filled template only, no preamble
