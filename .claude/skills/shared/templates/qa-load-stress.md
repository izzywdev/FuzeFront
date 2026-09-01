## 🧪 QA Task — Load & Stress Tests: [Endpoint / Service]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Test Type** | Load & Stress Test |
| **Assignee** | [QA Engineer / DevOps] |
| **Story Points** | [4 / 8] |
| **Tool** | [k6 / JMeter / Locust / Artillery] |
| **Environment** | Staging only — NEVER run on Production |

---

### 📌 What to Test
[Which endpoints or flows are load-tested, and what real-world scenario they simulate.]

### 📊 Performance Targets
| Metric | Target | Max Acceptable |
|--------|--------|----------------|
| p50 response time | < 100ms | 200ms |
| p95 response time | < 300ms | 500ms |
| p99 response time | < 800ms | 1500ms |
| Error rate | < 0.1% | 1% |
| Throughput | [100 req/s] | — |
| Peak concurrent VUs | [500] | — |

### 🧪 Test Scenarios

#### 1. Baseline Load
- **VUs:** 50 | **Duration:** 5 min | **Ramp-up:** 1 min
- **Goal:** Confirm p95 < target at normal expected traffic

#### 2. Peak Load
- **VUs:** 200 | **Duration:** 10 min | **Ramp-up:** 2 min
- **Goal:** System holds at expected peak without degradation

#### 3. Stress Test (break it)
- **VUs:** Ramp from 200, add 100/min until error rate > 1%
- **Goal:** Find the breaking point; confirm graceful degradation, not hard crash

#### 4. Spike Test
- **Pattern:** 10 VUs → 500 in 30 sec → back to 10
- **Goal:** Auto-scaling / recovery works; measure time-to-recover

### 🔗 Endpoints Under Test
| Endpoint | Method | Payload | Target RPS |
|----------|--------|---------|-----------|
| `/api/v1/[resource]` | GET | — | [100] |
| `/api/v1/[resource]` | POST | ~2KB | [20] |

### ✅ Acceptance Criteria
- [ ] p95 ≤ target at baseline and peak load
- [ ] Error rate ≤ 0.1% at peak
- [ ] System recovers to baseline within 2 min after spike
- [ ] No memory leak after 10-min sustained run

### 📋 Post-Test Deliverables
- [ ] HTML summary report (k6 / JMeter / Artillery)
- [ ] Screenshot of monitoring dashboards during peak
- [ ] Written analysis of any breached thresholds

### 📎 References
- Story: [PROJ-XXX]
- Infrastructure sizing doc: [link]
