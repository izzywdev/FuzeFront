---
skill: ticket-creator/qa/load-stress
---

# Load & Stress Test Creator

## Required information — ask if missing
1. **Which endpoints or flows are being load-tested?**
2. **What business scenario does the test simulate?** (e.g., "End-of-month batch billing for 5,000 businesses")
3. **Which Story does this belong to?**

## Template
Load `../../../shared/templates/qa-load-stress.md` and fill it.

## Field guidance

### Performance Targets
- Fill all 6 rows of the targets table
- If the user doesn't provide targets, use the template defaults and mark them as `[TBD — confirm with DevOps]`

### Scenarios
- All 4 scenarios (Baseline, Peak, Stress, Spike) are required — always

## Output rules
- Output the filled template only, no preamble
