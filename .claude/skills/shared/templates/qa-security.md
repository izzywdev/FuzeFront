## 🧪 QA Task — Security Tests: [Feature / Endpoint / System]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Test Type** | Security Test |
| **Assignee** | [Security Engineer / QA Lead] |
| **Story Points** | [4 / 8] |
| **Tool** | [OWASP ZAP / Burp Suite / Custom scripts / Manual] |
| **Environment** | Staging only — NEVER run intrusive scans on Production |

---

### 📌 Scope
[Which endpoints, features, or system boundaries are in scope for this security test.]

### 🛡️ OWASP Top 10 Checklist
| # | Category | Test Method | Result |
|---|----------|-------------|--------|
| A01 | Broken Access Control | Access resource as lower-privilege role; try IDOR | — |
| A02 | Cryptographic Failures | Verify TLS; check logs/responses for PII | — |
| A03 | Injection (SQL, NoSQL, Command) | Inject payloads in inputs, URL params, headers | — |
| A04 | Insecure Design | Manual review of business logic for logic-level flaws | — |
| A05 | Security Misconfiguration | Check HTTP headers, CORS, verbose errors, default creds | — |
| A06 | Vulnerable Components | Run `npm audit` / `pip audit`; check CVEs | — |
| A07 | Auth & Session Failures | Test session fixation, logout, token expiry, brute force | — |
| A08 | Data Integrity Failures | Verify signed releases / supply chain | — |
| A09 | Logging Failures | Confirm audit logs exist for sensitive actions | — |
| A10 | SSRF | Test if server can be induced to call internal URLs | — |

### 🔬 Feature-Specific Test Cases
| # | Test | Method | Expected |
|---|------|--------|----------|
| 1 | Auth bypass | Remove JWT, call protected endpoint | `401`; no data exposed |
| 2 | IDOR | Change resource ID to another user's | `403` returned |
| 3 | XSS | Inject `<script>` in all text inputs | Input sanitized / escaped |
| 4 | Rate limiting | 200+ requests/min to auth endpoint | `429` after threshold |
| 5 | PII in logs | Trigger flow; inspect logs | No PII or tokens found |
| 6 | Role escalation | Partner action as business role | `403` returned |

### 🔐 API Security Checklist
- [ ] All endpoints require auth except explicitly documented public ones
- [ ] Role-based access enforced on all protected routes
- [ ] Rate limiting applied to auth and sensitive mutation endpoints
- [ ] Passwords, tokens, secrets never returned in API responses
- [ ] Security headers present: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `CSP`

### ✅ Acceptance Criteria
- [ ] No Critical or High OWASP vulnerabilities found
- [ ] All Medium findings documented with owner and remediation plan
- [ ] Auth bypass and IDOR return `401` / `403` as expected
- [ ] No sensitive data in API responses, error messages, or logs
- [ ] ZAP / Burp scan report attached to this ticket

### 📎 References
- Story: [PROJ-XXX]
- OWASP Testing Guide: https://owasp.org/www-project-web-security-testing-guide/
