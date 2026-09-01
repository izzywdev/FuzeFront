---
name: endpoint-authorization
description: Use when building or reviewing any HTTP/event endpoint. The checklist + Fuze auth architecture for authN-middleware coverage, object/field-level authorization (BOLA/BOPLA mitigation), and input validation — and how to add requireOwnership / permit.check / schema validation. Enforced by gate-authz; owned by appsec-reviewer.
---

# endpoint-authorization

Per `governance/architecture-guidelines.md`. Reference: FuzeFront `backend/src/middleware/permissions.ts`.

## Checklist (every endpoint)
1. **AuthN** — behind verified auth middleware (`authenticate` / `Depends(get_current_user)` / NextAuth). No public-by-default.
2. **Object-level authz (BOLA/IDOR)** — before returning/mutating a resource fetched by id, authorize the *specific* object: `await permit.check(user, action, resource, ctx)` and/or `requireOwnership(getOwnerId)`. Never `findById(req.params.id)` without an ownership/permission gate.
3. **Field-level authz (BOPLA)** — set only an explicit allow-list of fields on writes (no raw-body mass-assignment); project only entitled fields on reads.
4. **Input validation** — schema (Zod/pydantic/Joi) on params + body; reject unknown fields.

## Patterns
- **Express**: `router.get('/x/:id', authenticate, requirePermission({action:'read',resource:'x'}), handler)` or `requireOwnership(req => getXOwner(req.params.id))`.
- **FastAPI**: `@router.get('/x/{id}')` + `Depends(get_current_user)`; in-handler `permit.check(user,'read',f'x:{id}')`; pydantic body models.
- Use the **Permit.io PDP** (offline locally) for policy; reserve raw role-`if`s for trivial cases.

## How to detect BOLA in review/CI
Grep/Semgrep for resource-by-id access (`findById`, `findOne({_id`, `where({ id`, `get(id)`) in a handler with **no** nearby `permit.check`/`requireOwnership`/ownership filter → flag. `gate-authz` automates this; adjudicate logic-level cases by tracing the owner check.

## Fixing a finding
Add the missing middleware/`permit.check`/`requireOwnership`/schema; add a test that a non-owner gets 403 and an owner 200. Hand implementation to `backend-engineer`.
