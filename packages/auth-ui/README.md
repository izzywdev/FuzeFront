# @fuzefront/auth-ui

Reusable sign-in / sign-up UI for FuzeFront — the `AuthPanel` React component plus a
zero-dependency vanilla (non-React) mount, both built design-system-first on
`@fuzefront/design-system` and typed against the frozen `@fuzefront/security-client`
contract.

## Why

`frontend/src/pages/LoginPage.tsx` implements sign-in/sign-up inline, coupled to the
host app's `LanguageContext`, `useCurrentUser`, and asset imports. This package
extracts the same behavior into an injectable, framework-boundary-clean component so
it can be reused by other FuzeFront-family apps (and, via the vanilla build, by
non-React hosts) without pulling in the host's context providers.

## Usage (React)

```tsx
import { AuthPanel } from '@fuzefront/auth-ui'
import '@fuzefront/auth-ui/styles.css'

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

## Redesigned signup (`fuzefront.auth.experience`, default OFF)

`AuthPanel experience` (or `<SignUpFlow />` on its own) renders the redesigned
account-creation flow from the approved frames (`design/frames/auth-experience/01-signup`,
`06-states`):

- **One optional full-name field** (`autoComplete="name"`, `data-field="full-name"`) — the
  contract's single `name`; first/last are gone from `SignupRequest` (security-client 1.0.0).
- **Work email with debounced inline availability** (`transport.checkEmailAvailable` →
  `GET /v1/security/signup/email-available`). **Fail-open**: a rejection renders "couldn't
  check" and never blocks submit; `taken` is advisory (the `409` from `signup` is the authority).
- **Password strength meter + per-rule checklist** driven by `AuthMethods.passwordPolicy`
  (`data-pwmeter` / `data-pwreq` / `data-req` / `data-met`), **confirm with live match**
  (`data-match`).
- **Cloudflare Turnstile** (`@marsidev/react-turnstile`), rendered **only** when
  `AuthMethods.captcha` is present; submit stays disabled until a token exists. Tokens are
  single-use, so every failed submit resets the widget.
- **Submit disabled until** the checklist passes, the confirmation matches and (when required)
  the challenge is verified.
- **Every failure is an explicit state**: `409` → sign in instead, weak password (inline *and*
  post-submit), provider unavailable → "Continue with Google" + retry, rate-limited, Turnstile
  failed, MFA-required handoff. `data-state` hooks follow `06-states.html`.

All copy is injected (`signupLabels`, `SignUpLabels`); the host maps its i18n keys
(`auth.signup.*`). The flag is resolved by the host (`isAuthExperienceEnabled()`); with it off
the current form is unchanged apart from the single `name` field.

Also exported: `FullNameField`, `InlineAvailabilityField`, `PasswordPolicyChecklist`,
`PasswordStrengthMeter`, `PasswordConfirmField`, `TurnstileField`, `SocialButton`,
`VerifyGateBanner` (the "verify your email to continue" gate banner).

## Usage (vanilla / non-React host)

```html
<link rel="stylesheet" href="node_modules/@fuzefront/auth-ui/dist/styles.css" />
<div id="auth-root"></div>
<script src="node_modules/@fuzefront/auth-ui/dist/auth-ui.vanilla.js"></script>
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

Built only from `@fuzefront/design-system` tokens/components (`Button`, `Input`,
`InlineValidatedInput`, `StrengthMeter`, `PasswordChecklist`, `TurnstileContainer`,
`Alert`, `SeamDivider`, `CenteredCard`). No hard-coded color/spacing/type.
