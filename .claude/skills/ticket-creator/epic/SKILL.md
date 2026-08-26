---
skill: ticket-creator/epic
---

# Epic Creator

## Purpose
Creates a complete, Jira-ready Epic ticket from a brief description.

## Sizing check (before creating)
Load `../../shared/templates/SIZING.md`.
Max Epic duration = N×D = 84 calendar days = 60 work days.
If the described scope clearly exceeds 6 sprints, add a ⚠️ prefix to the title and include a note
in the Problem Statement suggesting the Epic be decomposed.

## Required information — ask if missing
1. **What is the feature or initiative?** (1-sentence description)
2. **Which domain?** (Billing / Auth / Notifications / Partner Portal / etc.)
3. **What user or business problem does it solve?**

## Template
Load the template from `../../shared/templates/epic.md` and fill it.

## Field guidance

### Title
Format: `[Verb] + [specific outcome]` — not "Improve billing", but "Enable partners to self-manage billing cycles"

### Problem Statement
- Must be 1–3 sentences
- Must answer: "What breaks for the user/business today without this?"
- Must explain: "Why is this important now?"

### Goal
- One sentence only, written as an observable outcome
- Must be verifiable — "Partners can configure billing without contacting support" ✓ / "Better billing experience" ✗

### Features In Scope
- 3–6 items maximum
- Each item = a specific, deliverable capability (not a vague theme)
- If the user gives > 6 items, suggest splitting into 2 Epics and flag with ⚠️

### Success Metrics
- Must be quantifiable
- Include a current baseline if known; write `[Establish baseline in Sprint 1]` if unknown
- At least 1 row required

### Child Stories
- Leave empty (will be populated during Story Planning phase)

### Dependencies
- Only fill if the user explicitly mentions dependencies
- Leave as `—` if none known

## Output rules
- Output the filled template only, no preamble
- Use Jira-compatible markdown (bold, tables, checklists with `- [ ]`)
