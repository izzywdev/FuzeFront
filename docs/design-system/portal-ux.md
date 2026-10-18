# Portal UX & app-integration policy

**What the FuzeFront host shell is, how a federated app behaves inside it, and the line
between what the shell owns and what an app owns.** This is the policy that the shell code,
the `federated-apps` design frames, and EPIC-04 collectively implied but never stated in one
place. It is the companion to the design system: the design system governs *tokens and
primitives*; this governs *the runtime experience of mounting an app into the shell*.

Audience: anyone building a federated app that mounts into FuzeFront (in-repo or out), and
any agent (`product-designer`, `frontend-engineer`, `mobile-frontend-engineer`) building
shell or app UI.

> Mechanics of *registering* an app (manifest, init-container, serve path) are in
> `docs/mfe-self-registration.md` and `docs/guides/BUILDING_ON_FUZEFRONT.md`. Menu-injection
> patterns are in `docs/guides/app-navigation-and-menu-injection.md`. Slug / display-name /
> serve-path rules are the canonical section in `CLAUDE.md`. This doc is the *UX* contract,
> not the registration mechanics.

## 1. The model

FuzeFront is a **Module-Federation host shell**: a dark-default dashboard that discovers,
mounts and fuses remote micro-frontends ("apps") into one runtime experience. The shell
provides persistent chrome (top bar, navigation, launcher, identity, notifications); each app
provides a **content surface** mounted into the shell's content area, plus optional
navigation contributions. The shell's shared-dependency contract (React 19 singleton, the
design system) is stable and apps consume it — never bundle their own React.

An app is mounted by `frontend/src/utils/loadFederatedApp.ts` + `FederatedAppLoader.tsx`,
which resolve the app's `integration.remoteEntry` against the shell origin and render the
remote inside `Layout` → `.content-area`. Three integration types are supported
(`module-federation`, `iframe`/`spa`, `web-component`). The host-provided **context, props
and the mount loading/error/retry treatment reach a `module-federation` or `web-component`
remote** — one that shares the shell's `window` and receives component props. A cross-origin
`iframe`/`spa` app is sandboxed: it has its own `window`, does **not** receive
`window.__FUZEFRONT__`, `window.__FRONTFUSE_CONTEXT__` or props, and the loader renders it as a
plain sandboxed `<iframe src>` with no load-error/retry wrapper. So §3's in-shell behavior
contract below applies to same-origin MF/web-component remotes; an iframe app coordinates with
the host only through whatever `postMessage` channel it and the host agree on (none is defined
today).

## 2. Shell owns vs. app owns — the ownership boundary

This table is the contract. If you are building an app and find yourself re-implementing a
"shell owns" row inside your remote, stop — consume the shell's instead.

| Concern | Owner | Where |
|---|---|---|
| Top bar (logo, launcher, tenant selector, theme toggle, user menu) | **Shell** | `TopBar.tsx` |
| Primary side navigation | **Shell** (unless the app opts into substitution) | `SidePanel.tsx` |
| App launcher (9-dots grid) | **Shell** | `AppSelector.tsx` |
| Organization / account switching | **Shell** (app subscribes, never renders its own switcher) | `bridge.ts` `onOrgSwitch`/`onAccountSwitch` |
| Toast / notification surface | **Shell** (app calls `bridge.notify`) | `bridge.ts`, `<Toaster>` in `Layout.tsx` |
| "Return to portal" control in substitution mode | **Shell** (non-removable — an app cannot trap the user) | `SidePanel.tsx` |
| Auth token / session context | **Shell** (injected; the remote reads it from the `getToken` prop or `window.__FRONTFUSE_CONTEXT__.getAccessToken` — **not** from the bridge, which has no token method) | `FederatedAppLoader.tsx` `getToken`, `window.__FRONTFUSE_CONTEXT__` |
| Theme (dark/light) + brand accent | **Shell** (app inherits CSS tokens; never hard-codes) | `PortalThemeScope` |
| Mount loading / error / retry while the remote loads | **Shell** | `FederatedAppLoader.tsx`, `FederatedAppErrorBoundary.tsx` |
| The app's own content surface | **App** | the remote |
| The app's *internal* loading / empty / error states (data it fetches) | **App** | the remote |
| Injected sub-menu items for the active app | **App** (via the bridge) | `bridge.ts` `menu.add/remove` |
| A full substituted navigation hierarchy | **App** (declared in its manifest `chrome.menu: "substitute"`) | manifest + `SidePanel.tsx` |

## 3. The in-shell behavior contract — what a mounted app must and must not do

1. **Do not render shell chrome.** No app-level top bar, org switcher, theme toggle, or
   global toaster. Use `window.__FUZEFRONT__` (bridge, CONTRACT_VERSION 2) for toasts
   (`notify`/`dismiss`), menu contributions (`menu.add/remove`), and context
   (`getContext`/`subscribe`, `onOrgSwitch`, `onAccountSwitch`). Re-rendering these is the
   most common integration bug — it double-draws controls and desyncs on org switch.
2. **Own your content's states; do not own the mount's.** The shell renders the spinner,
   error boundary and Retry while your *remoteEntry* loads. Once mounted, **you** render the
   loading/empty/error/fail-closed states for the data *you* fetch — these are contract, not
   decoration (see the design-first pipeline). Do not reach for `window.location` reloads on
   error; surface a ret: the shell's error boundary offers "Go to Dashboard".
3. **Scroll ownership.** The content area is sized `calc(100dvh - var(--top-bar-height) - …)`;
   your surface scrolls within it. Do not create a second full-page scroll context or set
   `body { overflow }`.
4. **Routing.** Portal mount is `/app/<slug>/…`; standalone is the app's own origin root.
   Route with a **prefix-relative basename** so the same build works in both. Call the API on
   a **same-origin base** — never a hard-coded absolute host (works identically under local
   TLS and prod ingress; avoids mixed-content in the TWA). Slug ≠ serve path ≠ display name —
   see the canonical `CLAUDE.md` section; never derive one from another.
5. **Menu contributions.** Prefer additive injection (`menu.add`) for a few app actions.
   Use full substitution (`chrome.menu: "substitute"`) only for a genuinely standalone
   navigation hierarchy — and the shell will still render the non-removable "Return to
   portal" control. You cannot remove it.
6. **Theme & direction.** Inherit the shell's `data-theme` and accent tokens; support RTL/LTR.
   No raw hex/px/font — `gate-ds-conformance` enforces this.

## 4. Mount modes

| Mode | Chrome | Route | Status |
|---|---|---|---|
| **portal** | full shell chrome; app in `.content-area` | `/app/<slug>` | live |
| **standalone** | no chrome, edge-to-edge | app origin root (or `/standalone/<slug>`) | live (`StandaloneAppSurface.tsx`) |
| **embed** | host-defined | host-defined | planning (`docs/planning/app-suites-and-modes.md`) |
| **locked** (white-label, own domain, no return-to-portal) | de-branded | own domain | planning, flag OFF (`docs/planning/locked-app-mode.md`) |

"Mobile requires standalone" — the Android TWA wraps the standalone surface, not the portal
chrome. See `app-suites-and-modes.md`.

## 5. Mobile in the shell

The portal is **one shell from phone to wide desktop** and declares mobile *required*
(`.fuze/manifest.json` → `mobile`: breakpoints 375/768/1024, ≥44px tap targets). The
breakpoint scale, the nav transition, touch targets and safe-area rules are the design
system's **"Mobile & responsiveness"** guideline
(`docs/design-system/artifact/project/README.md`) — that is the source of truth for the
tokens and the responsive model; do not restate it, link to it.

**Current shell behavior (accurate as of this writing):** below `md` (≤768px) the persistent
`SidePanel` becomes a slide-in **drawer** dismissed by a scrim (`Layout.tsx`
`isSidebarOpen` + `.sidebar-scrim`; `SidePanel.tsx`), the top bar collapses to
`top-bar-height-mobile`, and the org/language controls move into the user menu (`TopBar.tsx`
header note). **Known gap:** the design system's mobile guideline also specifies a
`BottomNav` below `md`, and the `BottomNav` primitive exists in the design system, but it is
**not yet wired into the host shell** — the shell uses drawer-only today. Wiring `BottomNav`
into the shell is `mobile-frontend-engineer` work and needs its own approved mobile frames;
it is tracked, not silently reconciled away. Until then, an app author should expect
drawer-based nav on phone and must not assume a bottom nav bar.

## 6. How this is enforced, and where it is only policy

- **Design-system-first** (tokens only): `gate-ds-conformance` — enforcing on changed lines.
- **Design before UI** (an approved frame covers the screen): `gate-frames-first` —
  BLOCKED hard-fails; uncovered is on the ramp. **Mobile coverage** of a flow is part of the
  frames contract (`product-designer` authors mobile frames; schema `frames[].viewport` /
  `build.flows[].responsive`); the responsive-coverage check lands with `gate-frames-schema`.
- **It runs clean** (console-clean at desktop *and* mobile viewport): `ui-runtime-validation`
  skill — today an agent/QA self-check, moving toward a CI gate.
- **Mobile layout actually works**: the `mobile-layout` Playwright spec (iPhone 12) — see the
  CI gate list; being promoted to merge-blocking.

Anything above described as "policy" (the ownership table, the in-shell behavior rules) is
enforced by review and by this document today; where a gate exists it is named. If you find
the shell code and this doc disagreeing, the code is the runtime truth — fix the doc in place
and flag the drift.
