---
skill: ticket-creator/ux
---

# UX Task Creator

## Purpose
Creates a complete, Jira-ready UX Task sub-ticket from a brief design brief.

## Required information — ask if missing
1. **What screen or flow is being designed?**
2. **What is the user trying to accomplish?**
3. **Which Story does this belong to?** (Story ID)

## Template
Load `../../shared/templates/ux.md` and fill it.

## Field guidance

### Title
Format: `[Screen name / Flow] — [Action]`
Examples: "Partner Billing Overview — Design all states", "Auto-recharge Setup Flow — Redesign error handling"

### Design Goals
- 2–3 specific, measurable goals
- "Improve UX" is not a goal — "Reduce checkout steps from 4 to 2" is

### Required States
- All 7 states in the template are required by default
- If a specific state genuinely doesn't apply (e.g., no empty state for a settings form), strike it through with a reason

### User Flow
- Number each step
- Each step = one atomic action by the user or one system response
- Cover the happy path + the most critical error path

## Output rules
- Output the filled template only, no preamble
