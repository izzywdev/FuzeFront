# Minimal external app registration + heartbeat

The smallest copy-paste example of how an external application registers
itself with FuzeFront and reports that it is alive — raw HTTP, no SDK, no
Kubernetes, so it works the same from a laptop or from any language.

For the real deploy-time mechanics (Helm init container, sealed secrets,
idempotent re-registration) see [`docs/mfe-self-registration.md`](../mfe-self-registration.md)
and [`@fuzefront/onboarding-kit`](../../packages/onboarding-kit/README.md).
This page is the "what actually goes over the wire" companion to those —
read it first if you just want to see one request/response round trip.

The frozen contract behind every call below is
[`services/app-registry-service/openapi.yaml`](../../services/app-registry-service/openapi.yaml).
For a typed Node/TypeScript client instead of raw `curl`, see
[`apps-client`](../../apps-client) (`@fuzefront/app-registry-client`), which maps
1:1 to the same operations — except for the heartbeat token, see the note below.

## 0. What you need before you start

| Thing | Where it comes from |
|---|---|
| `FUZEFRONT_API_URL` | The applications-service base URL, e.g. `https://api.fuzefront.com` (prod) or `http://localhost:3003` (local). The app-registry routes are mounted under `/api/v1/app-registry`. |
| `FUZEFRONT_REGISTRATION_TOKEN` | A pre-shared, platform-wide bearer token (`CONSUMER_REGISTRATION_SECRET`). Not a JWT, not per-app — see [`docs/mfe-self-registration.md` § Auth token](../mfe-self-registration.md#auth-token) for how to obtain one. |

Every call below sends this token as `Authorization: Bearer $FUZEFRONT_REGISTRATION_TOKEN`.

## 1. Register

### Minimum payload

Only the fields marked **required** below must be present. Everything else
is optional and the platform fills in a sane default (an app with no `nav`
lands last, in the `platform` section; no `visibility` defaults to private).

```jsonc
{
  "manifest": {
    "manifestVersion": "1",     // required — literal "1"
    "slug": "myapp",            // required — immutable once registered, see note below
    "name": "MyApp",            // required
    "menuLabel": "MyApp",       // required — shown in the side menu
    "mode": "standalone",       // required — "portal" | "standalone"
    "integration": {            // required
      "type": "iframe",         // required — "module-federation" | "iframe" | "web-component" | "spa"
      "url": "https://myapp.example.com/"   // required for "iframe"
    }
    // optional below this line:
    // "description": "...",
    // "nav": { "section": "build", "order": 10 },
    // "visibility": "organization"
  }
}
```

> **`slug` is free-form but immutable once registered** — there is no rename
> endpoint. Picking a `fuze`-prefixed or unprefixed slug is your call either
> way; just don't plan on changing it later. See the root `CLAUDE.md` §
> "`slug`, display name, and the federated serve path are THREE INDEPENDENT
> questions" for the full rule if you're unsure.

### Request

```bash
curl -i -X POST "$FUZEFRONT_API_URL/api/v1/app-registry/apps" \
  -H "Authorization: Bearer $FUZEFRONT_REGISTRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "manifest": {
          "manifestVersion": "1",
          "slug": "myapp",
          "name": "MyApp",
          "menuLabel": "MyApp",
          "mode": "standalone",
          "integration": { "type": "iframe", "url": "https://myapp.example.com/" }
        }
      }'
```

`-i` matters here — the response you need is split across the body and a
response **header** (see below).

### Expected success response

`201 Created`, body = the stored `App` record, **plus** a response header
carrying your heartbeat token:

```
HTTP/1.1 201 Created
X-App-Heartbeat-Token: 9f3a1c2e7b4d5f6089ab...   <- save this, it is shown ONCE
Content-Type: application/json

{
  "slug": "myapp",
  "status": "registered",
  "mode": "standalone",
  "builtin": false,
  "organizationId": null,
  "manifest": { "manifestVersion": "1", "slug": "myapp", "name": "MyApp", "menuLabel": "MyApp", "mode": "standalone", "integration": { "type": "iframe", "url": "https://myapp.example.com/" } },
  "isHealthy": null,
  "lastSeenAt": null,
  "createdAt": "2026-10-05T12:00:00.000Z",
  "updatedAt": "2026-10-05T12:00:00.000Z"
}
```

> **The heartbeat token is only ever returned on this one response, as the
> `X-App-Heartbeat-Token` header — it is never included in the JSON body and
> there is no endpoint to fetch it again later.** Store it alongside your
> app's own config now. The `apps-client` TypeScript SDK's `registerApp()`
> currently returns only the parsed body and drops this header, so if you
> need the heartbeat token, call `POST /apps` with a plain HTTP client (as
> above) rather than through that SDK method until it is updated.

A `registered` app is **not yet visible** in the menu — that is step 2.

### One common failure: slug already taken

```bash
curl -i -X POST "$FUZEFRONT_API_URL/api/v1/app-registry/apps" \
  -H "Authorization: Bearer $FUZEFRONT_REGISTRATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "manifest": { "manifestVersion": "1", "slug": "myapp", "name": "MyApp", "menuLabel": "MyApp", "mode": "standalone", "integration": { "type": "iframe", "url": "https://myapp.example.com/" } } }'
```

```
HTTP/1.1 409 Conflict
Content-Type: application/json

{ "error": "conflict", "message": "An app with this slug already exists" }
```

Registration is meant to be called on every pod start, so a 409 here from a
second replica of your *own* app is expected and not a problem — just don't
treat it as fatal. (A malformed manifest instead gets `400` with
`{ "error": "validation_error", "fields": [...] }`; an unset/incorrect
registration token gets `503 consumer_registration_unavailable` or
`401 invalid_registration_token` respectively — see
[`docs/mfe-self-registration.md` § Diagnosing a 401 or 503](../mfe-self-registration.md#diagnosing-a-401-or-503).)

## 2. Activate — make it appear in the menu

```bash
curl -i -X POST "$FUZEFRONT_API_URL/api/v1/app-registry/apps/myapp/activate" \
  -H "Authorization: Bearer $FUZEFRONT_REGISTRATION_TOKEN"
```

```
HTTP/1.1 200 OK

{ "slug": "myapp", "status": "activated", ... }
```

Idempotent — activating an already-activated app is a no-op `200`.

## 3. Heartbeat — report liveness

Call this periodically from your running app (a few times per heartbeat
interval your ops team expects) using the token from step 1 — **not** the
registration token:

```bash
curl -i -X POST "$FUZEFRONT_API_URL/api/v1/app-registry/apps/myapp/heartbeat" \
  -H "Authorization: Bearer 9f3a1c2e7b4d5f6089ab..." \
  -H "Content-Type: application/json" \
  -d '{ "status": "online" }'
```

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "accepted": true, "at": "2026-10-05T12:05:00.000Z" }
```

`status` is required and is either `"online"` or `"degraded"`; an optional
free-form `metadata` object (version, build, etc.) may ride alongside it.
A wrong/expired heartbeat token gets `401 Unauthorized`; heartbeating a slug
that doesn't exist gets `404`.

## Where to go next

- Full field reference: [`services/app-registry-service/openapi.yaml`](../../services/app-registry-service/openapi.yaml)
  (`AppManifest`, `RegisterAppRequest`, `HeartbeatRequest` schemas).
- Typed client: [`apps-client`](../../apps-client) (`@fuzefront/app-registry-client`).
- Production registration pattern (Helm init container, idempotent
  re-registration, policy + billing profile onboarding):
  [`docs/mfe-self-registration.md`](../mfe-self-registration.md) and
  [`packages/onboarding-kit/README.md`](../../packages/onboarding-kit/README.md).
- Side-menu placement (`nav.section` / `nav.order`): see either doc above.
