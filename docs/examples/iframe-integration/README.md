# Iframe integration example

A minimal, runnable example of registering an app with FuzeFront via
`integration.type: "iframe"` instead of Module Federation. See
[`docs/guides/BUILDING_ON_FUZEFRONT.md` §1c](../../guides/BUILDING_ON_FUZEFRONT.md#1c-register-an-iframe-app)
for the narrative version of this walkthrough — this directory is the
"working example" that section links to.

## Files

| File | What it is |
|---|---|
| [`app/index.html`](app/index.html) | The entire "product" — a single static page with no build step. This is what gets embedded. |
| [`manifest.json`](manifest.json) | The smallest valid `AppManifest` for an iframe integration. |

## Run it locally

1. Serve the example app on its own port:

   ```bash
   npx serve docs/examples/iframe-integration/app -p 5180
   # or: python3 -m http.server 5180 --directory docs/examples/iframe-integration/app
   ```

2. Register `manifest.json` against a locally running FuzeFront backend
   (`integration.url` in the manifest already points at
   `http://localhost:5180/`):

   ```bash
   curl -X POST http://localhost:3000/api/v1/app-registry/apps \
     -H 'Authorization: Bearer <jwt>' \
     -H 'Content-Type: application/json' \
     -d "{\"manifest\": $(cat docs/examples/iframe-integration/manifest.json)}"
   ```

3. Open the portal and launch "Iframe Example" from the menu. The shell
   mounts `app/index.html` inside a sandboxed `<iframe>` at `/app/iframe-example`.

## Why this is useful as a reference

- It is the **smallest manifest that round-trips**: no `remoteEntry`, no
  `scope`, no `module`, no build tooling on the embedded side at all — just
  `integration.type` + `integration.url`.
- It demonstrates the **auth boundary** an iframe integration actually has
  (`postMessage`, not `window.__FRONTFUSE_CONTEXT__`) — see the comments in
  `app/index.html` and the caveats section linked above.
- Because `slug` is immutable once registered (see the root `CLAUDE.md` §
  "`slug`, display name, and the federated serve path are THREE INDEPENDENT
  questions"), this example's `slug` (`iframe-example`) is deliberately
  disposable — delete and re-register under a fresh slug if you need to
  reset it in a local environment.
