## 🐛 Bug: [Short Description of What's Broken]

| Field | Value |
|-------|-------|
| **Bug ID** | [PROJ-XXX] |
| **Severity** | [Critical / High / Medium / Low] |
| **Priority** | [Critical / High / Medium / Low] |
| **Environment** | [Production / Staging / Dev] |
| **Found By** | [Name] |
| **Date Found** | [YYYY-MM-DD] |
| **Assignee** | [Developer] |
| **Affected Version** | [v1.2.3] |

---

### 📌 Summary
> [One sentence: what is broken and what is the impact on users or the business?]

### 🔁 Steps to Reproduce
1. Navigate to [exact URL or screen name]
2. [Action — be specific: e.g., "Click the 'Save Payment' button"]
3. [Action — be specific: e.g., "Fill field X with value Y"]
4. **Observe:** [exactly what happens that is wrong]

### ✅ Expected Behavior
[What should happen. Reference the spec, Figma design, or previous working behavior.]

### ❌ Actual Behavior
[What actually happens. Paste error messages verbatim. Include HTTP status codes if API error.]

### 🌍 Environment Details
| Field | Value |
|-------|-------|
| Browser / Client | [Chrome 125 / iOS 17 / Android 14 / Postman] |
| User Role | [admin / agent / business / partner] |
| Account / Business ID | [ID — only if safe and relevant] |
| Screen / URL | [Exact URL or screen path] |

### 📸 Evidence
- [ ] Screenshot: [attach or link]
- [ ] Screen recording: [attach or link]
- [ ] Sentry / error tracker: [direct link to event]
- [ ] Console / server logs: [paste relevant lines]
- [ ] API response body (if network error): [paste]

### 💥 Severity Assessment
- [ ] **Critical** — Data loss / system down / payment failure / security breach
- [ ] **High** — Core feature broken, no workaround exists
- [ ] **Medium** — Feature degraded, workaround available
- [ ] **Low** — Cosmetic issue, no data impact

### 📋 Spawn Sub-Tasks (when fix requires significant work)
| Type | Summary | Assignee | Points |
|------|---------|----------|--------|
| Backend | [the code fix] | — | [2/4/8] |
| QA (Unit) | [regression unit test] | — | [2/4/8] |
| QA (Functional) | [verify scenario fixed] | — | [2/4/8] |
| Frontend | [UI fix if needed] — optional | — | [2/4/8] |
| Docs | [update if needed] — optional | — | [2/4/8] |
| DevOps | [infra fix if needed] — optional | — | [2/4/8] |

### 🔍 Root Cause *(developer fills after investigation)*
[What caused this? Which commit/deploy introduced it?]

### 🔧 Fix Description *(developer fills after fix)*
[What was changed? Link to PR / commit.]

### ✔️ Verification Steps *(QA fills after fix)*
1. [Step to confirm bug no longer reproduces]
2. [Step to test edge cases around the fix]
3. [Step to confirm no regression in related features]

### 🔗 Related
- Parent Epic: [PROJ-XXX]
- Parent Story: [PROJ-XXX]
- Duplicate of: [PROJ-XXX] (if applicable)
- Relates to: [PROJ-XXX] (if triggered by a specific story)
