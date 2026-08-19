---
skill: ticket-creator/qa/integration
---

# Integration Test Creator

## Required information — ask if missing
1. **Which services or systems are being integrated?** (e.g., BillingService ↔ Cardcom gateway)
2. **Which Story does this belong to?**

## Template
Load `../../../shared/templates/qa-integration.md` and fill it.

## Field guidance

### Integration Points Table
- List every pair of systems that communicate
- Note the protocol (REST / DB / Queue / Webhook)

### Mock vs Real
- State clearly which dependencies are real and which are mocked
- Explain why (cost, availability, isolation)

## Output rules
- Output the filled template only, no preamble
