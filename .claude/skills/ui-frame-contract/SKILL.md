---
name: ui-frame-contract
description: Use in the frontend-design phase, before feature-UI implementation. Produce static HTML frame(s) — a single page or a SEQUENCE demonstrating the flow — as approved artifacts frozen with the API contract; Playwright later runs against them as pre-production verification.
---

# ui-frame-contract

The frontend-design phase produces static **HTML frames** of the expected UI before any feature-UI is implemented. These approved frames are part of the contract freeze (alongside the OpenAPI/event contract) — the visual source of truth the implementation is checked against, so visual/structural drift is caught against a frozen artifact rather than discovered after the fact.

## When
The frontend-design phase, **before** feature-UI implementation. Authored by `frontend-engineer`; part of the contract freeze the parallel fan-out depends on (the gate). Pairs with `api-contract-first` and `frontend-design`.

## What a frame is
A static, self-contained **HTML file** rendering the expected UI of one screen, **design-system-first** — it links the design system's stylesheet and uses only DS tokens/styles, **no raw hex/rgb, raw px spacing, or one-off type** (consistent with `design-system-conformance`). A feature may be a **single page** or an **ordered SEQUENCE** of frames demonstrating the process/flow — e.g. login → create-org → billing → checkout. The sequence shows the flow, not just isolated screens.

## Where they live + manifest
Frames live at **`design/frames/<feature>/*.html`** plus **`design/frames/<feature>/manifest.json`**. The manifest holds an ordered `frames` array plus top-level approval fields:

```json
{
  "approved": true,
  "approvedBy": "<name>",
  "approvedAt": "<ISO date>",
  "frames": [
    { "id": "login", "file": "01-login.html", "title": "Sign in", "route": "/login", "acceptanceNotes": "..." }
  ]
}
```

The **`approved: true`** marker (with approver + date) is what **freezes** the frames.

## Procedure

1. **Derive the screens/states** from the user story — the pages and the order of the flow.
2. **Build the frame(s) design-system-first** at `design/frames/<feature>/*.html`, linking the DS stylesheet; write the ordered `manifest.json`.
3. **Review and approve** — set the approval marker (`approved: true` + `approvedBy` + `approvedAt`).
4. **Freeze WITH the contract PR.** `contract-designer`'s frozen contract **includes** the approved frames; the contract PR is **not a valid gate** until the frames exist and are approved.

## Playwright against frames
`frontend-test-engineer` runs **Playwright against the approved frames** for visual/structural assertions as **pre-production** verification — in **addition** to the built app and the live app. The frames are the visual source of truth the implementation is checked against, not a replacement for app/live e2e.

## Done checklist
- [ ] frame(s) at `design/frames/<feature>/*.html`, design-system-first (no raw values)
- [ ] single page or ordered SEQUENCE covering the flow
- [ ] `manifest.json` with ordered `frames` (id/file/title/route/acceptanceNotes)
- [ ] approval marker set (`approved: true` + approver + date)
- [ ] frozen WITH the contract PR (`contract-designer`'s gate includes them)
- [ ] `frontend-test-engineer` can run Playwright against the frames pre-production
