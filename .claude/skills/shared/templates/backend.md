## ⚙️ Backend Task: [Service — Action — Entity]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Assignee** | [Developer] |
| **Priority** | [High / Medium / Low] |
| **Story Points** | [2 / 4 / 8] |
| **Stack** | [Node.js / Python / PHP] · [Express / FastAPI / Symfony] |

---

### 📌 Context
[1–2 sentences: What service, module, or endpoint is being built or changed, and why.]

### 🔌 API Specification

| Field | Value |
|-------|-------|
| **Method + Path** | `[GET/POST/PUT/PATCH/DELETE] /api/v[X]/[resource]` |
| **Auth** | [JWT Bearer / API Key / Public] |
| **Role Required** | [admin / partner / business / agent / any] |

**Request Body:**
```json
{
  "fieldName": "string (required)",
  "optionalField": "number | null"
}
```

**Success Response ([2XX]):**
```json
{
  "id": "uuid",
  "fieldName": "value",
  "createdAt": "2025-01-15T09:00:00Z"
}
```

**Error Responses:**
| Code | Condition |
|------|-----------|
| `400` | Validation failed — [which field, why] |
| `401` | Missing or expired auth token |
| `403` | Role [X] lacks permission |
| `404` | [Resource] not found |
| `409` | Conflict — [e.g., duplicate entry] |

### 🗃️ Database Changes
- [ ] New table: `table_name` — schema below
- [ ] Migration: [describe what changes]
- [ ] Index on `column_name` — reason: [performance / uniqueness]
- [ ] No DB changes required

```sql
CREATE TABLE table_name (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  field_name VARCHAR(255) NOT NULL
);
```

### 📋 Implementation Tasks
1. [ ] Create/update entity or model
2. [ ] Implement service method: `methodName()`
3. [ ] Implement controller / handler / route
4. [ ] Add input validation (using [Joi / Zod / custom validator])
5. [ ] Handle error cases: [list each one]
6. [ ] Write unit tests for the service layer

### ✅ Acceptance Criteria
1. `[METHOD] /api/v1/[resource]` returns `[status]` with the correct payload
2. Invalid payload returns `400` with field-level error messages
3. Unauthenticated request returns `401`
4. [Business rule] is enforced: [describe precisely]
5. DB records created/updated correctly — no orphaned records
6. No regressions in related existing endpoints

### 🧪 Testing Requirements
- [ ] Unit test: happy path — [scenario]
- [ ] Unit test: validation error — [field / input]
- [ ] Unit test: not found — [resource]
- [ ] Unit test: [business edge case]
- [ ] Unit test: authorization — [role denied]

### ⚠️ Notes / Constraints
- [Performance: paginate responses — max 100 rows per page]
- [Security: sanitize [field] before use in query]
- [Data integrity: write-once entity — no UPDATE or DELETE]

### 📎 References
- API design doc: [link]
- Parent story: [PROJ-XXX]
- Related frontend ticket: [PROJ-XXX]
