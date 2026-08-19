---
skill: ticket-creator/bug
---

# Bug Creator

## Purpose
Creates a complete, Jira-ready Bug ticket including severity assessment and optional spawn sub-tasks.

## Before creating
1. Load `../../shared/templates/BUG_RULES.md` to determine correct placement (under Epic or Story)
2. Load `../../shared/templates/SIZING.md` to apply severity SLAs

## Required information — ask if missing
1. **What is broken? What is the impact?** (one sentence)
2. **Steps to reproduce** (numbered list, at minimum 2 steps)
3. **Expected vs actual behavior**
4. **Severity** (Critical / High / Medium / Low)
5. **Where was it found?** (Production / Staging / Dev)

## Template
Load `../../shared/templates/bug.md` and fill it.

## Field guidance

### Title
Format: `[What's broken] — [impact]`
Examples: "Auto-recharge charges partner balance instead of platform gateway — overcharging businesses"
NOT: "Bug in billing" or "Fix billing issue"

### Steps to Reproduce
- Must be numbered, specific, and reproducible by someone who wasn't there
- Include the exact URL, the exact button clicked, the exact input value
- Minimum 3 steps

### Severity vs Priority
- **Severity** = impact on the system (data loss / core broken / degraded / cosmetic)
- **Priority** = urgency to fix (aligned with SLAs from SIZING.md)
- They can differ: a cosmetic bug on the payment confirmation page might have Low severity but High priority

### Spawn Sub-Tasks
- If the user confirms the fix requires > 2 hours of work, include the Spawn Sub-Tasks table
- Mark Backend + QA (Unit + Functional) as required; others as optional
- Add story points from {2, 4, 8} to each sub-task

### Placement
- If the bug was found during development of a specific story → parent = that Story, add "Relates to [STORY-ID]" link
- If found independently in production → parent = the relevant Epic

## Output rules
- Output the filled template only, no preamble
