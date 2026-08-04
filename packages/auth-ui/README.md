# @fuzeone/auth-ui

Reusable sign-in / sign-up UI for FuzeFront — the `AuthPanel` React component plus a
zero-dependency vanilla (non-React) mount, both built design-system-first on
`@fuzeone/design-system` and typed against the frozen `@fuzeone/security-client`
contract.

## Why

`frontend/src/pages/LoginPage.tsx` implements sign-in/sign-up inline, coupled to the
host app's `LanguageContext`, `useCurrentUser`, and asset imports. This package
extracts the same behavior into an injectable, framework-boundary-clean component so
it can be reused by other FuzeFront-family apps (and, via the vanilla build, by
non-React hosts) without pulling in the host's context providers.

## Usage (React)

```tsx
import { AuthPanel } from '@fuzeone/auth-ui'
import '@fuzeone/auth-ui/styles.css'

<AuthPanel
  variant="full"
  transport={{
    login: (req) => securityClient.login(req),
    signup: (req) => securityClient.signup(req),
    getAuthMethods: () => securityClient.getAuthMethods(),
    startSocial: (provider) => securityClient.startSocial(provider),
  }}
  onAuthenticated={(session) => { /* hydrate + redirect */ }}
  onMfaRequired={(challenge) => { /* show step-up UI */ }}
  social
/>
```

`transport` is the injection seam: this package never imports `useLanguage`,
`useCurrentUser`, `window.location`, or any asset — the host wires those in via the
transport + `onAuthenticated`/`onMfaRequired` callbacks.

## Usage (vanilla / non-React host)

```html
<link rel="stylesheet" href="node_modules/@fuzeone/auth-ui/dist/styles.css" />
<div id="auth-root"></div>
<script src="node_modules/@fuzeone/auth-ui/dist/auth-ui.vanilla.js"></script>
<script>
  const instance = window.FuzeFrontAuthUI.mount(document.getElementById('auth-root'), {
    transport: { login, signup, getAuthMethods },
    onAuthenticated: (session) => { /* ... */ },
  })
  // later: instance.unmount()
</script>
```

The vanilla build is a zero-dependency IIFE — it does not bundle React or React-DOM.

## Design system

Built only from `@fuzeone/design-system` tokens/components (`Button`, `Input`,
`Alert`, `SeamDivider`, `CenteredCard`). No hard-coded color/spacing/type.
