## 🧪 QA Task — Integration Tests: [Service A ↔ Service B]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Test Type** | Integration Test |
| **Assignee** | [Developer / QA Engineer] |
| **Story Points** | [2 / 4 / 8] |
| **Tool** | [Jest + Supertest / Pytest + httpx / Postman Collection] |
| **Environment** | Dev or Staging — with real dependencies |

---

### 📌 Integration Points to Test
| Component A | Integration Type | Component B |
|------------|-----------------|-------------|
| [ServiceA] | REST API call | [ServiceB] |
| [ServiceA] | DB read/write | [PostgreSQL] |
| [WebhookHandler] | HTTP callback | [External Gateway] |

### 🔬 Test Scenarios

#### Service → Database
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Create entity via API → verify DB record | Record exists with correct field values |
| 2 | Update entity → verify propagated to DB | Record updated; updated_at changed |
| 3 | DB constraint violation | `409` returned; no partial record |

#### Service → Service
| # | Scenario | Expected |
|---|----------|----------|
| 4 | [ServiceA] calls [ServiceB] successfully | Data flows correctly |
| 5 | [ServiceB] returns 500 or is unreachable | [ServiceA] handles gracefully; no crash |

#### Webhook / External
| # | Scenario | Expected |
|---|----------|----------|
| 6 | Valid webhook received | Processed; DB updated; `200` returned |
| 7 | Invalid signature | Rejected with `401`; nothing written to DB |
| 8 | Duplicate webhook (same ID twice) | Idempotent — only one record created |

### 🛠️ Environment Requirements
- **Real dependencies:** [PostgreSQL / Redis / etc.]
- **Mocked:** [external gateway] — reason: [cost / availability]
- **Cleanup:** [transaction rollback / table truncation in teardown]

### ✅ Acceptance Criteria
- [ ] All service → DB scenarios produce correct final DB state
- [ ] Downstream service failure handled gracefully (no crash, no data corruption)
- [ ] Webhooks validated, processed, and idempotent
- [ ] All tests idempotent — same outcome whether run once or ten times

### 📎 References
- Implementation: [PROJ-XXX]
- Architecture diagram: [link]
