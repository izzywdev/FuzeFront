# @fuzefront/chat-ui

Design-system-first React chat UI for the FuzeFront **chat-service**. Renders a
streaming assistant (SSE), RAG source citations, and the agent mutating-tool
confirmation prompts — built **only** from `@fuzefront/design-system` tokens
(the "fuse seam" system). Zero hard-coded colors / spacing / type.

Consumes the typed `@fuzefront/chat-client` SSE event union
(`text_delta` / `rag_sources` / `tool_pending` / `tool_result` / `tool_denied` /
`done` / `error`).

## Install (private — GitHub Packages)

```jsonc
// .npmrc
@fuzefront:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm i @fuzefront/chat-ui @fuzefront/chat-client
```

## Usage

```tsx
import { ChatServiceClient } from '@fuzefront/chat-client'
import { ChatWidget } from '@fuzefront/chat-ui'
import '@fuzefront/chat-ui/styles.css' // token-based styles (load once)

const client = new ChatServiceClient({
  baseUrl: `${window.location.origin}/chat-api`,
  getToken: () => localStorage.getItem('authToken'),
})

;<ChatWidget client={client} orgId={activeOrganizationId} dir="ltr" />
```

The styles reference design-system CSS variables (`--bg-*`, `--accent-*`,
`--space-*`, …) defined by the host shell / `@fuzefront/design-system`. Mount the
widget inside a tree where those variables are in scope.

## RTL / a11y

- Mirrors automatically via CSS **logical properties** — pass `dir="rtl"`.
- All strings come from the i18n layer (`ChatI18nProvider` / `strings` prop);
  no hard-coded copy. (Mirrors the shape of the future `@fuzefront/i18n`.)
- Dialog/log landmarks, labelled controls, keyboard composer (Enter / Shift+Enter),
  visible fuse-seam focus rings, `aria-pressed` feedback, `role="alert"` errors.

## Exports

- `ChatWidget` — self-contained launcher + drawer + state (drives `useChat`).
- `ChatPanel`, `MessageList`, `MessageItem`, `Composer`, `Citations`,
  `ConfirmationCard`, `FeedbackButtons` — presentational pieces for custom layouts.
- `useChat`, `chatReducer` — drive a fully custom UI directly.
- `ChatI18nProvider`, `useChatI18n` — strings + direction.

## Build / test

```bash
npm run build       # tsup: ESM + CJS + .d.ts + styles.css
npm run type-check  # tsc --noEmit
npm test            # vitest: reducer + hook + render/a11y/RTL
```
