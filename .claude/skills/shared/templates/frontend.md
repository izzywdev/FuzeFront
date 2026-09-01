## 🖥️ Frontend Task: [Component / Page — Action]

| Field | Value |
|-------|-------|
| **Task ID** | [PROJ-XXX] |
| **Parent Story** | [PROJ-XXX — Story Title] |
| **Assignee** | [Developer] |
| **Priority** | [High / Medium / Low] |
| **Story Points** | [2 / 4 / 8] |
| **Stack** | React · TypeScript · [React Query / Redux / etc.] |
| **Figma** | [link to exact frame] |

---

### 📌 Context
[1–2 sentences: What UI component or page is being built or changed, and why.]

### 📋 Implementation Tasks
1. [ ] Create/update component `<ComponentName />`
2. [ ] Define TypeScript props interface (see below)
3. [ ] Connect to API: `[METHOD /api/v1/resource]`
4. [ ] Handle all states: loading → error → empty → populated
5. [ ] Implement form validation rules: [list each rule]
6. [ ] Add to router at: `/[path]`
7. [ ] Ensure responsive behavior (375px mobile / 1440px desktop)

### 🧩 Component Props Interface
```ts
interface ComponentNameProps {
  propName: string;           // required — [what it represents]
  optionalProp?: number;      // optional — [what it controls]
  onAction: (id: string) => void; // callback — [when it fires]
}
```

### ✅ Acceptance Criteria
1. Matches the Figma frame — reviewed by dev + designer together
2. Loading state: skeleton or spinner shown while data is in-flight
3. Error state: user-friendly message — no raw API errors exposed in UI
4. Empty state: meaningful placeholder or call-to-action shown
5. Form validation: [specific rules] shown inline per field, before submit
6. No console errors or TypeScript compiler warnings
7. Lighthouse accessibility score ≥ 90

### 🧪 Testing Requirements (Jest + React Testing Library)
- [ ] Renders in default (populated) state without errors
- [ ] Renders loading state correctly
- [ ] Renders error state with message
- [ ] [Primary user interaction — e.g., form submit triggers API call]
- [ ] [Edge case — e.g., empty list shows empty state, max char enforced]

### ⚠️ Notes / Gotchas
- [Performance: memoize with React.memo if parent re-renders frequently]
- [a11y: all icon-only buttons must have aria-label]
- [UX: delay showing loading skeleton by 200ms to avoid flicker]

### 📎 References
- Figma: [link to exact frame]
- API docs / backend ticket: [PROJ-XXX or link]
- Parent story: [PROJ-XXX]
