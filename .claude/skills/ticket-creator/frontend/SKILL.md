---
skill: ticket-creator/frontend
---

# Frontend Task Creator

## Purpose
Creates a complete, Jira-ready Frontend Development sub-ticket.

## Story Points reminder
Valid values: {2, 4, 8} only. 1 point = 1 hour.
Estimate based on: 2=simple isolated component, 4=component with API + state, 8=full page or complex flow.

## Required information — ask if missing
1. **What UI component or page is being built?**
2. **What API endpoint does it consume?** (optional — fill with [TBD] if unknown)
3. **Is there a Figma link?** (optional — note if missing)
4. **Which Story does this belong to?**

## Template
Load `../../shared/templates/frontend.md` and fill it.

## Field guidance

### Title
Format: `[Component/Page name] — [Action]`
Examples: "PaymentMethodCard — Build with card-on-file display", "Partner Invoice List — Implement with pagination"

### Implementation Tasks
- List 5–8 concrete tasks
- Each task = one atomic implementation step (not a feature description)
- Include API connection, state handling, validation, responsiveness explicitly

### Component Props Interface
- Write TypeScript interface if the user provides component details
- If unknown, write `[TBD — developer to define during implementation]`

### Acceptance Criteria
- Must include: Figma match, all 4 states (loading/error/empty/populated), validation, a11y score ≥ 90
- Add domain-specific ACs from the user's description

### Testing Requirements
- Minimum 4 unit test cases — always
- Tests must be specific (not "test that it renders")

## Output rules
- Output the filled template only, no preamble
