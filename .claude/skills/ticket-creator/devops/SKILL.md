---
skill: ticket-creator/devops
---

# DevOps Task Creator

## Purpose
Creates a complete, Jira-ready DevOps Task sub-ticket including rollback plan.

## Required information — ask if missing
1. **What infrastructure or configuration change is needed?**
2. **Which environment?** (Dev / Staging / Production)
3. **What is the risk level?** (Low / Medium / High)
4. **Which Story does this belong to?**

## Template
Load `../../shared/templates/devops.md` and fill it.

## Field guidance

### Implementation Tasks
- Write each step as a runbook-style command or action — specific enough to execute
- Not: "Deploy the service" — but: "Run `helm upgrade billing-service ./charts/billing --set image.tag=v2.4.1`"

### Rollback Plan
- The trigger condition must be a measurable threshold (not "if something goes wrong")
- The steps must be executable without the author being present

### Risk Level
- Low: config change, no downtime expected
- Medium: rolling restart, brief degradation possible
- High: data migration, schema change, or full service restart

## Output rules
- Output the filled template only, no preamble
