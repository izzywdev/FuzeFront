## 🧪 QA Task — Functional Tests: [Feature / User Flow]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Test Type** | Functional / E2E Test |
| **Assignee** | [QA Engineer] |
| **Story Points** | [2 / 4 / 8] |
| **Tool** | [Cypress / Playwright / Postman / Manual] |
| **Environment** | Staging |

---

### 📌 What to Test
[Which feature or user flow is being tested end-to-end.]

### 🔬 Test Scenarios

#### Happy Path
| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 1 | [Core flow] | [Step 1 → 2 → 3] | [Success state shown] |
| 2 | [Variation] | [Steps] | [Result] |

#### Edge Cases
| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 3 | [Boundary scenario] | [Steps] | [Result] |

#### Negative / Error Scenarios
| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 4 | Invalid input | [Submit invalid X] | [Inline validation shown] |
| 5 | Unauthorized access | [Navigate to /admin as guest] | [Redirect to login or 401] |
| 6 | Missing required field | [Submit without Y] | ["Y is required" shown] |
| 7 | Network error | [Simulate API failure] | [User-friendly error, no crash] |

### 🛠️ Test Data Requirements
- **Accounts:** [admin@test.com / partner@test.com / business@test.com]
- **Pre-existing seed data:** [describe what must exist before tests run]
- **Cleanup after run:** [what to reset or delete]

### ✅ Acceptance Criteria
- [ ] All happy path scenarios pass
- [ ] All error scenarios return correct message/status
- [ ] No regressions in: [list related features]
- [ ] Tested in: [Chrome / Safari / Firefox + 375px mobile viewport]

### 📎 References
- Parent story: [PROJ-XXX]
- Figma (expected UI states): [link]
- API docs: [link]
