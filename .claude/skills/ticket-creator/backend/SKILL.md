---
skill: ticket-creator/backend
---

# Backend Task Creator

## Purpose
Creates a complete, Jira-ready Backend Development sub-ticket including full API spec.

## Story Points reminder
Valid values: {2, 4, 8}. 1 point = 1 hour.
Estimate: 2=simple CRUD endpoint, 4=endpoint with business logic + validation, 8=complex service with DB changes.

## Required information — ask if missing
1. **What does this endpoint or service do?**
2. **What HTTP method and path?** (optional — infer from description if possible)
3. **Are there DB changes?** (new table / migration / index)
4. **Which Story does this belong to?**

## Template
Load `../../shared/templates/backend.md` and fill it.

## Field guidance

### Title
Format: `[Service name] — [Action] — [Entity]`
Examples: "BillingService — Create invoice on renewal", "PartnerService — Add self-managed payment flag"

### API Specification
- Fill Method + Path even if approximate (the dev will correct during implementation)
- Include ALL error responses that the business logic can produce — not just standard HTTP ones
- Request body: include every field with its type and whether it is required
- Response: include the exact shape with field names and types

### Database Changes
- If new table: include the full CREATE TABLE SQL with reasonable column types
- If migration: describe precisely which column is being added, removed, or renamed
- Mark as "No DB changes" explicitly if that is the case

### Business Rule
- Extract the core business rule from the description and state it explicitly in Acceptance Criteria
- Example: "A partner with `isPaymentManagedByPartner=true` must NOT be charged via the platform gateway"

### Testing Requirements
- Minimum 4 unit test cases — always
- Include at least: happy path, validation error, not-found, and one business rule enforcement test

## Output rules
- Output the filled template only, no preamble
