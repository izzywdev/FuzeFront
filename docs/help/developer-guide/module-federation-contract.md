---
title: The Module Federation Contract
description: The shared-singleton, chunk-path, and same-origin rules a remote must follow so the FuzeFront shell can load it.
audience: developer
order: 3
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# The Module Federation Contract

The shell loads remotes at runtime. It never builds against them, so the only thing keeping the two sides compatible is a small set of agreed rules. Break one and the failure shows up in the browser, with nothing in CI to warn you first.

## How the shell loads a remote

The shell reads your registered manifest from the app registry and calls the federation runtime (`@originjs/vite-plugin-federation`) with `integration.remoteEntry`, `integration.scope`, and `integration.module`. The implementation is `frontend/src/utils/loadFederatedApp.ts`:

- `remoteEntry` is the **complete** entry (for example `/apps/my-app/remoteEntry.js`), not a base URL.
- It is resolved against the shell's own origin. A same-origin path must stay on that origin; a `//host/...` style value is rejected, because a browser would resolve it cross-origin and run someone else's module inside the shell.
- An absolute `http(s)` URL is accepted for remotes hosted outside the cluster.
- For same-origin entries the shell appends a cache-busting query so a stale `remoteEntry.js` cannot point at chunks a new deploy removed.

## Rule 1: React is a shared singleton, with an identical range

The host declares:

```ts
shared: {
  react: { singleton: true, requiredVersion: '^19.0.0' },
  'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
}
```

Your remote must declare the **same** block, with the same `requiredVersion`. See `frontend/vite.config.ts` (host) and `clock-app/vite.config.ts` (reference remote).

Why it matters: the host seeds the shared scope with its one React instance. If your range differs, or you use the bare `['react', 'react-dom']` shorthand (which does not set `singleton`), the federation runtime can decide your remote needs its own copy. Two React copies means hooks run against the wrong dispatcher and the app fails with **"Invalid hook call"**, or hangs on the loading spinner. Nothing in your build or the host's CI reports it.

Raising the React major is a family-wide change: the host, in-repo remotes, every published peer range and every external remote move together. Do not change your side alone.

## Rule 2: chunks must resolve where you serve them

`remoteEntry.js` is only the manifest of the remote; the real code is in chunks it imports by relative path. Set Vite's `base` to the exact path you serve the remote at, and emit chunks beside the entry:

```ts
base: '/apps/my-app/',
build: { target: 'esnext', assetsDir: '' }
```

If `base` is wrong, `remoteEntry.js` returns 200 and every chunk 404s against the shell's own bundle. The healthcheck stays green and the panel is blank. The serve path must agree across four layers (details and the checklist are in [Registering your app](registering-your-app.md) and [Troubleshooting](troubleshooting.md)): the registered `remoteEntry`, Vite `base`, the Ingress `path`, and the nginx `location` or `alias`.

## Rule 3: same-origin, TLS-safe requests

- Call the API with relative paths (`/api/v1/...`). The shell's API base is same-origin, so it works under local TLS and production ingress without change.
- Do not hard-code an `http://` host or an absolute API URL. Under TLS the browser blocks it as mixed content.
- Prefer serving your remote on the shell's origin under `/apps/<slug>/`. A separate public hostname adds a second edge hop, can sit behind an access wall that answers asset requests with an HTML login page, and needs CORS. Only a remote genuinely hosted outside the cluster should use its own absolute URL, and then it must send permissive CORS headers so the shell can fetch it.

## Rule 4: expose one default-exported component

`exposes` maps a key such as `./App` to a module whose **default export** is a React component. The shell fails with "did not provide a default export" otherwise. The key is your registered `integration.module`; the federation `name` is your `integration.scope`.

## Alternatives to federation

If you cannot share React 19, use another integration type: `iframe` for hard isolation or non-JS apps, or `web-component` for a framework-agnostic custom element. Both are valid `integration.type` values in the registry contract (`services/app-registry-service/openapi.yaml`). They trade seamless integration for isolation. The platform bridge on `window.__FUZEFRONT__` is not injected into an iframe, so an iframe app must establish identity on its own.

## Checklist

- Node `>=24.0.0`, React `^19.2.0`, `shared` block identical to the host.
- `exposes` key is a default-exported component.
- `base` equals the path you serve and register; `assetsDir: ''`.
- No absolute API hosts, no `http://` URLs in code.

Next: [Design system](design-system.md) and [Registering your app](registering-your-app.md).
