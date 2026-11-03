---
title: Troubleshooting
description: Diagnose the most common ways a FuzeFront remote fails to load, render, register, or authenticate.
audience: developer
order: 10
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Troubleshooting

Most remote failures happen in the browser, after a green build and a green healthcheck. Open the browser developer tools first and look at the **Console** and **Network** tabs. A clean console (no errors, no failed requests, no mixed-content or CSP blocks) is the bar for calling UI work done.

## "Invalid hook call", or the panel hangs on the spinner

**Cause:** your remote loaded its own copy of React, so hooks run against a different React than the one rendering them. This happens when your `shared` block differs from the host's.

**Check:** your `vite.config.ts` must contain exactly:

```ts
shared: {
  react: { singleton: true, requiredVersion: '^19.0.0' } as any,
  'react-dom': { singleton: true, requiredVersion: '^19.0.0' } as any,
}
```

- The `requiredVersion` must equal the host's `^19.0.0` (`frontend/vite.config.ts`).
- Do not use the bare `['react', 'react-dom']` shorthand; it does not set `singleton`.
- Confirm your installed `react` and `react-dom` are `^19.2.0`, and that only one copy exists (`npm ls react`).

See [The Module Federation contract](module-federation-contract.md).

## `remoteEntry.js` returns 200 but the panel is blank and chunks return 404

**Cause:** the serve path disagrees across layers, so the entry loads and every chunk it imports resolves to the wrong place. The healthcheck is green because it only hits the entry.

**Check all four layers use the same path** (convention `/apps/<slug>/`):

| Layer | Where to look |
|---|---|
| Registered `integration.remoteEntry` | `registration/manifest.json` and its vendored Helm copy (keep them byte-identical) |
| Vite `base` (with `assetsDir: ''`) | your `vite.config.ts` |
| Ingress `path` | your chart's Ingress for the federated mount |
| nginx `location` or `alias` | your chart's nginx ConfigMap, or the baked `nginx.conf` |

In the Network tab, find the first 404 and compare its URL to where the file actually lives. Fix the **path**, never the `slug`: the slug is immutable and is not an input to loading. Rules are in [Registering your app](registering-your-app.md).

## "Failed to fetch dynamically imported module"

Usually the request for `remoteEntry.js` or a chunk did not return JavaScript. Open the failing request and read the response body. An HTML login page means an access wall sits in front of the host you registered (hosts under the production subdomain are behind one). Serve the remote on the shell's own origin under `/apps/<slug>/` instead of a separate public host. A cross-origin remote also needs CORS headers on both the entry and its chunks.

## "Refusing to load remote entry"

The shell rejects a `remoteEntry` that would resolve off-origin when it was written as a path, such as `//host/x.js` or a value with a backslash, and any non-http scheme. Use either an absolute path (`/apps/<slug>/assets/remoteEntry.js`) or a full `https://` URL. The check is in `frontend/src/utils/loadFederatedApp.ts`.

## "did not provide a default export"

The `exposes` entry must point at a module whose default export is a React component, and the registered `module` must equal that key (for example `./App`). Also check the registered `scope` equals your federation `name`.

## Mixed content or CSP errors under TLS

**Cause:** something requests an `http://` URL from an `https://` page, or an absolute API host is hard-coded. **Fix:** call the API with same-origin relative paths such as `/api/v1/security/session`, and load remotes by same-origin path or an `https://` URL. Search your code and build env for `http://` and for absolute API hosts.

## App is registered but not in the menu

New apps are `registered` and invisible until **activated**. Check `GET /api/v1/app-registry/apps/{slug}` for `status`. The onboarding kit activates for you; if you registered by hand, call `POST /api/v1/app-registry/apps/{slug}/activate`. Also check `visibility`, `scopeLevel`, and whether the app requires an organization context and the user is in personal context.

## Registration fails and the pod will not start

The init container exits non-zero on purpose. Read its logs. Common causes:

- `401 {"error":"invalid_registration_token"}`: the secret is configured but your `FUZEFRONT_REGISTRATION_TOKEN` is stale or wrong. Refresh your sealed `fuzefront-registration` Secret.
- `503 {"error":"consumer_registration_unavailable"}`: the platform has no registration secret configured; this is not fixable from your side. Contact the platform team.
- `400`: the manifest is invalid. Run `npx fuzefront-validate-registration registration` locally.
- `409` on create is treated as success by the kit (another replica registered first).

Details: `docs/mfe-self-registration.md`.

## Sign-in loops, 401, or 403

- **Redirect loop:** do not implement your own OIDC redirect. Read identity from `GET /api/v1/security/session` on the same origin and let the shell own sign-in. Typical causes are an app redirecting to a login route on a different origin or discarding the session.
- **401 on `/api/v1/security/session`:** no valid token. Call the `getToken` prop the shell passes to your component for each request, and re-authenticate when it returns null.
- **403 from `authz/check` or an endpoint:** the user lacks the permission. Confirm the resource and action are declared in your `policy.json`; an undeclared action silently grants nothing. Validate with `npx fuzefront-validate-policy registration/policy.json`.
- **`tenantId` is null:** deny tenant-scoped actions; do not default a tenant.

See [Authentication and authorization](authentication-and-authorization.md).

## Still stuck

Check the [Developer Portal](developer-portal.md) for the exact contract, re-read the [Quickstart](quickstart-build-a-microfrontend.md), and if you cannot resolve it, contact the platform team with the failing request URL and the console output.
