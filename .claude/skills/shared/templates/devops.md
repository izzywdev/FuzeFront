## 🚀 DevOps Task: [Action — Service / Environment]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Assignee** | [DevOps Engineer] |
| **Priority** | [High / Medium / Low] |
| **Story Points** | [2 / 4 / 8] |
| **Environment** | [Dev / Staging / Production] |
| **Risk Level** | [Low / Medium / High] |
| **Planned Window** | [YYYY-MM-DD HH:MM – HH:MM UTC] |

---

### 📌 Context
[1–2 sentences: What infrastructure, pipeline, or configuration change is needed, and why.]

### 📋 Implementation Tasks
1. [ ] [Specific action — written like a runbook entry]
2. [ ] [Specific action]
3. [ ] [Specific action]
4. [ ] Validate: `[health check URL or CLI command]`
5. [ ] Notify team in [#channel]: complete at [time]

### ⚙️ Configuration Changes
```yaml
# Before
service:
  replicas: 2
  env:
    FEATURE_FLAG: "false"

# After
service:
  replicas: 4
  env:
    FEATURE_FLAG: "true"
```

### ☑️ Pre-Deployment Checklist
- [ ] Change reviewed and approved by [lead / manager]
- [ ] Backup or snapshot taken of [DB / config / service state]
- [ ] Maintenance window scheduled and stakeholders notified
- [ ] Rollback procedure written, reviewed, and dry-run tested in staging
- [ ] Monitoring dashboards ready for post-deploy observation

### ✅ Acceptance Criteria
1. Change applied successfully to [environment]
2. Health check passes: `[URL or CLI command]`
3. Monitoring shows no unexpected errors for 15 min post-deploy
4. No unplanned service interruption (or within agreed window)
5. Change recorded in the infrastructure changelog

### 🔄 Rollback Plan
**Trigger:** [Exact condition — e.g., error rate > 1% OR p95 > 2s]

**Steps:**
1. [Step 1: e.g., revert Helm chart to previous tagged version]
2. [Step 2: e.g., restart pods and wait for readiness]
3. Verify health check passes
4. Notify [who, in which channel, within how many minutes]

### 🔒 Security Checklist
- [ ] No secrets, passwords, or tokens hardcoded in any config or script
- [ ] Least-privilege IAM / RBAC applied to this change
- [ ] Audit logging enabled for all actions
- [ ] TLS / encryption in transit verified for new paths

### 📎 References
- Infrastructure docs: [link]
- Parent story: [PROJ-XXX]
