## 🧪 QA Task — Unit Tests: [Module / Component Being Tested]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Test Type** | Unit Test |
| **Assignee** | [Developer — unit tests owned by the dev who built the feature] |
| **Story Points** | [2 / 4 / 8] |
| **Tool** | [Jest / Pytest / PHPUnit] |

---

### 📌 What to Test
[Which functions, methods, classes, or React components these unit tests cover, and why they are critical.]

### 🔬 Test Scenarios

#### Happy Path
| # | Given | Input | Expected Output |
|---|-------|-------|-----------------|
| 1 | [valid state] | [valid input] | [correct return value] |
| 2 | [valid state, variation] | [different input] | [correct return] |

#### Edge Cases
| # | Given | Input | Expected Output |
|---|-------|-------|-----------------|
| 3 | [state] | [boundary value — 0, maxInt, empty string] | [expected] |
| 4 | [state] | [null / undefined / missing field] | [error or default] |

#### Error Cases
| # | Given | Input | Expected Output |
|---|-------|-------|-----------------|
| 5 | [state] | [invalid type] | [throws TypeError or error returned] |
| 6 | [state] | [out-of-range value] | [throws or returns specific error code] |

### 📊 Coverage Requirements
- **Minimum:** ≥ 80% line + branch coverage across all files in scope
- **100% required on critical paths:**
  - [e.g., billing calculation logic]
  - [e.g., auth token validation]

### ✅ Acceptance Criteria
- [ ] All test scenarios pass with no pending or skipped tests (without reason)
- [ ] Coverage ≥ 80% confirmed in coverage report
- [ ] Tests run in isolation — no shared mutable state between test cases
- [ ] Full suite for this module runs in < [X] seconds

### 📎 References
- Implementation ticket: [PROJ-XXX]
- File(s) under test: `[path/to/module.ts]`
