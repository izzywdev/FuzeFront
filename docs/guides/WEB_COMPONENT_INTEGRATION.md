# Integrating an app as a Web Component

A third way to mount a product inside the FuzeFront shell, alongside
Module Federation and `iframe`. Pick it when you want a framework-agnostic,
Shadow-DOM-isolated widget that is still a first-class citizen of the shell
(same page, no navigation, reads the shell's user/session context) — without
taking on Module Federation's shared-singleton contract (host and remote on
the exact same React major, see [`BUILDING_ON_FUZEFRONT.md`](BUILDING_ON_FUZEFRONT.md)).

This doc is grounded directly in the loader the shell actually runs —
`frontend/src/components/FederatedAppLoader.tsx` — not in an aspirational
API. If that file's `web-component` branch changes, this doc is stale; the
code is the source of truth.

## 1. The smallest valid registration

A `web-component` app is registered the same way as any other app — a
manifest matching `packages/onboarding-kit/manifest.schema.json` — with
`integration.type` set to `web-component`:

```jsonc
// registration/manifest.json
{
  "manifestVersion": "1",
  "slug": "mywidget",
  "name": "My Widget",
  "menuLabel": "My Widget",
  "mode": "portal",
  "integration": {
    "type": "web-component",
    // The <script src> the shell injects to define your element.
    "url": "/apps/mywidget/widget.js",
    // Becomes the custom element TAG NAME the shell instantiates.
    // Must be a valid custom-element name (lowercase, contains a hyphen).
    "scope": "my-widget"
  },
  "nav": { "section": "build", "order": 10 },
  "routing": { "path": "/app/mywidget" },
  "visibility": "organization"
}
```

That is the whole registration surface for this integration type: no
`remoteEntry`, no `module` (those are Module-Federation-only fields). Note
the schema does **not** mark `url`/`scope` as required for `web-component`
the way it does for `module-federation` — so a manifest with neither still
passes validation but renders nothing (see §2). Treat them as required in
practice.

## 2. The custom-element / bundle contract

This is exactly what `FederatedAppLoader.tsx` does when
`integration.type === 'web-component'` — read it as the spec:

1. **Tag name.** The shell instantiates `document.createElement(tag)` where
   `tag = integration.scope`, or — if `scope` is omitted —
   `app-${name.toLowerCase().replace(/\s+/g, '-')}`. Set `scope` explicitly;
   don't rely on the fallback.
2. **Loading the bundle.** If a custom element with that tag name is
   **not** already registered (`customElements.get(tag)` is falsy), the
   shell appends `<script src="{integration.url}" async>` to `<head>`, then
   waits on `customElements.whenDefined(tag)` before mounting. **Your
   bundle's only job is to call `customElements.define(tag, YourClass)`** —
   top-level, synchronously on load. No default export, no init function the
   shell calls.
3. **Mounting.** Once defined, the shell creates the element and sets two
   attributes before appending it:
   - `data-app-slug="<your manifest slug>"`
   - `data-app-name="<your manifest name>"`
   These are the **only** data the shell passes via the element itself.
   Read them in `connectedCallback` via `this.getAttribute(...)`.
4. **Everything else comes off `window`, not props.** Before mounting, the
   shell sets:
   ```ts
   window.__FRONTFUSE_PLATFORM__ = true
   window.__FRONTFUSE_CONTEXT__ = {
     user,            // the signed-in user, or null
     session,         // { id, userId, tenantId, expiresAt } | null
     apps,            // the full app registry list
     activeApp,       // this app's registry entry
     isPlatformMode: true,
     getAccessToken,  // () => string | null — call this, never read a token off window
   }
   ```
   Read `window.__FRONTFUSE_CONTEXT__` from your element (it is reassigned
   on every user/portal change, so don't cache it past a render). Call
   `getAccessToken()` to get a token for your own API calls — the shell
   never hands you the token value as a static field.
5. **No unmount hook today.** The shell checks `el.hasChildNodes()` to avoid
   double-mounting on re-render, but nothing calls a teardown on your element
   when the user navigates away and the wrapper unmounts — React removes the
   DOM node, which fires your `disconnectedCallback` if you defined one, but
   there is no explicit "shell is unmounting you" signal beyond that. Don't
   rely on a bespoke lifecycle callback the shell doesn't call.

There is no shadow-DOM requirement from the shell's side — using
`attachShadow` for style isolation is your choice, not part of the contract.

## 3. A tiny, directly runnable example

A bundle with **zero dependencies**, framework-agnostic, that satisfies the
contract above:

```js
// widget.js — served at /apps/mywidget/widget.js
class MyWidget extends HTMLElement {
  connectedCallback() {
    const slug = this.getAttribute('data-app-slug')
    const ctx = window.__FRONTFUSE_CONTEXT__ || {}
    const name = ctx.user?.name ?? 'there'

    this.innerHTML = `
      <div style="padding: 1rem; font-family: sans-serif;">
        <p>Hello, ${name}! This is "${slug}" running as a Web Component.</p>
        <button id="whoami">Who am I?</button>
      </div>
    `

    this.querySelector('#whoami').addEventListener('click', async () => {
      const token = ctx.getAccessToken?.()
      // Call your own API with the shell's token, same-origin — see the
      // "same-origin API base" rule in BUILDING_ON_FUZEFRONT.md §5.
      alert(token ? 'Got a token, length ' + token.length : 'No token yet')
    })
  }
}

// REQUIRED: the tag name here must match `integration.scope` in the manifest.
customElements.define('my-widget', MyWidget)
```

Pair it with the manifest from §1 (`"scope": "my-widget"`, `"url"` pointing
at wherever you serve `widget.js`) and register it the normal way — see
[`docs/mfe-self-registration.md`](../mfe-self-registration.md). Locally, any
static file server works: `npx serve .` and point `integration.url` at
`http://localhost:<port>/widget.js` while developing, same as you would for
an `iframe` app's URL.

To build the same thing with a framework instead of vanilla JS, compile your
component to a custom element (e.g. Lit, or a React component wrapped with a
library like `@r2wc/react-to-web-component`) and keep the `customElements.define`
call as the bundle's side effect — the contract above does not change.

## 4. Trade-offs vs. `iframe` and Module Federation

| | Web Component | `iframe` | Module Federation |
|---|---|---|---|
| **Isolation** | DOM-level only, unless you use Shadow DOM yourself | Full (separate browsing context, own `window`) | None — shares the host's React runtime |
| **Framework freedom** | Any framework, compiled to a custom element | Any technology at all | Must match the host's React major + shared singletons |
| **Access to shell context** | Direct, synchronous (`window.__FRONTFUSE_CONTEXT__`) | None built-in — needs `postMessage` you write yourself | Direct, via props/host context — richest integration |
| **Bundle size cost to host** | Own bundle, loaded once, cached by the browser like any script | None — the shell never parses the embedded page's JS | Shares host's React/React-DOM — usually the smallest marginal cost per app |
| **Styling leakage risk** | Can leak into/out of the page unless you use Shadow DOM | None — the iframe's styles never touch the host page | Highest — you're in the same document as the host, so an un-scoped style can clobber the shell's own CSS |
| **Crash containment** | A thrown error during `connectedCallback` surfaces in the host's console/error boundary | A crash inside the iframe cannot bring down the host page | A thrown error during render is caught by `FederatedAppErrorBoundary`, but a bad shared-dependency version can break the whole shell |
| **Dev/ops complexity** | Low — ship a script, define a tag | Lowest — ship any URL that renders a page | Highest — must track the host's `requiredVersion`, same-origin `base`, Ingress path, all in lockstep (see the 4-layer table in `BUILDING_ON_FUZEFRONT.md` §1) |
| **When to pick it** | Self-contained widgets that want host context without the MF version-lockstep tax | Legacy apps, non-JS stacks, or apps that need hard isolation from the host | Apps that need the richest integration and can commit to tracking the host's React major |

## See also

- [`BUILDING_ON_FUZEFRONT.md`](BUILDING_ON_FUZEFRONT.md) — the full onboarding guide (Module Federation registration, shared packages, auth).
- [`docs/mfe-self-registration.md`](../mfe-self-registration.md) — how any manifest (including `web-component`) actually gets registered at deploy time.
- `frontend/src/components/FederatedAppLoader.tsx` — the loader this doc describes; read it directly if behavior and doc ever disagree.
- `packages/onboarding-kit/manifest.schema.json` — the frozen `Integration` schema.
