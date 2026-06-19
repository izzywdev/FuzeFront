# Plan F — Frontend WorkspaceProvisioningGate + Org Context

**Date:** 2026-06-19  
**Scope:** `frontend/` host shell only (no new service, no Helm changes)  
**Depends on:** Plan B (backend personal-org provisioning on first OIDC login)  
**Feeds:** Plan G (org-account + invitation UI)

---

## 1. Capability & Hard Requirements

Gate the authenticated shell against the absence of a personal org. After first OIDC login, the backend provisions a `type:'personal'` org asynchronously. The frontend must:

- **Not block the login flow** — show a friendly "Creating your workspace…" screen instead of a broken app.
- **Poll** `GET /api/organizations` every ~1.5 s, unblock when a `type:'personal'` org appears.
- **Time-out** at ~30 s with a clear retry/error state.
- **Clean up on unmount** — no dangling intervals.
- Extend `AppState` with `organizations` / `activeOrganizationId` in a way Plan G can build on.
- Add "Sign up" entry on the login page (redirect into Authentik enrollment = OIDC login path).
- Add a stub "Create Organization" route (`/organizations/new`).
- i18n: en + he for all new strings.
- All component tests green; `tsc --noEmit` + `vite build` clean.

---

## 2. Library & Architecture Review

### Polling mechanism

| Option | Fit | Notes |
|---|---|---|
| `setInterval` (plain JS) | 100% | No extra dep; full control; trivial to clear on unmount |
| `react-query` `refetchInterval` | 90% | Excellent DX but adds ~30 kB, and we only need one polling site |
| `swr` | 85% | Lighter (~15 kB), but same rationale |
| WebSocket push | 60% | Backend would need to emit an event after provisioning — future enhancement |

**Recommendation: plain `setInterval` via `useRef` + `useEffect`.** No new dependency. The polling logic is isolated inside `WorkspaceProvisioningGate`; if we ever swap to WS push it's a single-component change.

### State management for org context

The existing pattern is a `useReducer` inside `AppProvider` with typed action strings. Plan G needs `organizations[]` and `activeOrganizationId` as first-class state. We extend the existing reducer — no new library, no extra context provider. This keeps the public API flat and consistent with what the rest of the shell uses.

**Recommendation: extend `AppState` / `appReducer` in `lib/shared.tsx`.**

### Componentization decision

`WorkspaceProvisioningGate` is host-shell-only (one consumer). Keep it inline in `frontend/src/components/`. The design-system primitive `ProvisioningCard` (spinner + status text) lives in `frontend/src/components/ui/` alongside the existing shadcn-aligned components. No npm package split (YAGNI — single consumer).

---

## 3. Design-System Component Spec

### `ProvisioningCard`

**Location:** `frontend/src/components/ui/ProvisioningCard.tsx`

**Purpose:** Full-viewport centered card shown while an async platform operation is in progress (provisioning, deployment, migration). Reusable for Plan G onboarding flows.

**Variants / States:**

| State | Spinner | Headline | Sub-text | Action |
|---|---|---|---|---|
| `loading` | seam-animated ring | from `title` prop | from `description` prop | — |
| `timeout` | — | "Taking longer than expected" | from `description` prop | Retry button |
| `error` | — | "Something went wrong" | from `description` prop | Retry button |

**Token usage:**
- Card background: `var(--bg-tertiary)` / `border: 1px solid var(--border-color)`
- Card top edge: `var(--seam)` gradient (2 px, the fuse-seam signature)
- Spinner ring track: `var(--border-strong)`
- Spinner ring fill: `var(--accent-color)` → `var(--accent-2)` (conic gradient animating)
- Headline: `var(--font-display)` / `var(--text-primary)`
- Sub-text: `var(--text-secondary)` / `var(--font-sans)`
- Retry button: `.btn .btn-primary` class (existing)
- Card radius: `var(--radius-xl)`
- Card shadow: `0 24px 60px -24px var(--shadow)`

**a11y:**
- Spinner has `role="status"` + `aria-label` from `title` prop
- Retry button is a real `<button>` with visible focus ring

**New CSS tokens added to `index.css`:**
- `--spinner-track` alias of `--border-strong` (semantic name for progress tracks)
- `@keyframes seam-spin` — conic gradient rotation for the spinner

**Props interface:**
```ts
interface ProvisioningCardProps {
  state: 'loading' | 'timeout' | 'error'
  title?: string          // defaults per state
  description?: string    // defaults per state
  onRetry?: () => void
}
```

---

## 4. `WorkspaceProvisioningGate` Spec

**Location:** `frontend/src/components/WorkspaceProvisioningGate.tsx`

**Behaviour:**
1. On mount → call `organizationsAPI.getOrganizations()`.
2. If a `type:'personal'` org is in the response → dispatch `SET_ORGANIZATIONS` + `SET_ACTIVE_ORGANIZATION`, render `children`.
3. Else → show `<ProvisioningCard state="loading" />`, start a `setInterval` (1 750 ms).
4. Each poll: check for personal org → unblock on success.
5. After 30 s without success → transition to `state="timeout"`.
6. Network error → `state="error"`.
7. Retry button → reset timer, restart polling.
8. Unmount → clear interval.

**Placement in `App.tsx`:**
```
AuthWrapper
  AppContent
    if !isAuthenticated → LoginPage
    else → WorkspaceProvisioningGate   ← NEW
               ChatProvider
                 Layout
                   Routes
```

---

## 5. `AppState` Org-Context Extensions (Plan G surface)

New fields on `AppState`:
```ts
organizations: Organization[]
activeOrganizationId: string | null
```

New action types:
```ts
| 'SET_ORGANIZATIONS'
| 'SET_ACTIVE_ORGANIZATION'
```

New public hook (exported from `lib/shared.tsx`):
```ts
export function useOrganizations(): {
  organizations: Organization[]
  activeOrganizationId: string | null
  activeOrganization: Organization | null
  setActiveOrganization: (id: string) => void
}
```

`Organization` type is imported from `services/api.ts` (already exported there).

---

## 6. i18n Keys

| Key | en | he |
|---|---|---|
| `provisioningTitle` | Creating your workspace… | יוצר את סביבת העבודה שלך… |
| `provisioningDescription` | Setting up your personal organization. This takes a moment. | מגדיר את הארגון האישי שלך. זה אורך רגע. |
| `provisioningTimeout` | Taking longer than expected | לוקח יותר זמן ממצופה |
| `provisioningTimeoutDesc` | Your workspace is still being created. | סביבת העבודה שלך עדיין נוצרת. |
| `provisioningError` | Something went wrong | משהו השתבש |
| `provisioningErrorDesc` | We couldn't verify your workspace. | לא הצלחנו לאמת את סביבת העבודה שלך. |
| `provisioningRetry` | Try again | נסה שוב |
| `signUp` | Create an account | צור חשבון |
| `signUpMessage` | New to FuzeFront? | חדש ב-FuzeFront? |
| `createOrganization` | Create Organization | צור ארגון |
| `organizationName` | Organization name | שם הארגון |
| `createOrganizationDesc` | Start collaborating with a new organization. | התחל לשתף פעולה עם ארגון חדש. |

---

## 7. Implementation Sequence

1. **CSS tokens** — add `--spinner-track` alias + `@keyframes seam-spin` to `index.css`.
2. **`ProvisioningCard`** — new component.
3. **`lib/shared.tsx`** — extend `AppState` + reducer + `useOrganizations()`.
4. **`WorkspaceProvisioningGate`** — new component, uses `organizationsAPI`.
5. **`App.tsx`** — wrap authenticated branch.
6. **`LoginPage.tsx`** — add "Sign up" affordance (OIDC enrollment redirect).
7. **`CreateOrganizationPage.tsx`** — stub form at `/organizations/new`.
8. **`LanguageContext.tsx`** — add new i18n keys.
9. **Tests** — `WorkspaceProvisioningGate.test.tsx`.

---

## 8. Test Plan (TDD)

File: `frontend/src/components/__tests__/WorkspaceProvisioningGate.test.tsx`

1. **renders children when personal org present** — mock `organizationsAPI.getOrganizations` to return `[{type:'personal', ...}]`; assert children appear, spinner absent.
2. **shows ProvisioningCard during polling** — mock returns `[]`; assert spinner/title visible.
3. **unblocks when personal org arrives on poll** — first call returns `[]`, second returns `[{type:'personal'}]`; advance fake timers; assert children render.
4. **timeout state after 30 s** — mock always returns `[]`; advance 30 s; assert timeout message + retry button.
5. **error state on network failure** — mock rejects; assert error card.
6. **stops polling on unmount** — unmount after poll starts; assert no calls after unmount (via mock call count).

Test framework: **Vitest** (already in devDeps) with `@testing-library/react` — need to add `@testing-library/react` and `@testing-library/user-event`.

---

## 9. Concerns & Risks

- **`@testing-library/react` not yet in devDeps** — must add it. Adding `@testing-library/jest-dom` for matchers too.
- **vitest `environment: 'jsdom'`** not declared in `vite.config.ts` — need a `vitest.config.ts` shim or inline config in `vite.config.ts` test block.
- **Personal org type field** — backend must set `type: 'personal'` on the auto-provisioned org. Plan B should guarantee this; Plan F treats it as a contract. If absent, gate will timeout — clear error message covers this.
- **Plan G build surface** — `useOrganizations()` hook and `AppState.organizations` are public and stable; Plan G can call `setActiveOrganization(id)` to switch workspaces.
- **No Helm / Argo changes** — this is pure frontend; no deploy wiring change needed.
