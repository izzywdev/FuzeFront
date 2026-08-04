# custom-hostname-api — VENDORED CONTRACT (owned by FuzeInfra)

> **This is not a FuzeFront service.** Nothing here is built, deployed, or run by
> this repo. It is a pinned copy of a contract FuzeInfra owns, vendored so that
> `@fuzeone/custom-hostname-client` is generated from a byte-stable input.

The real service lives at
[`izzywdev/FuzeInfra:services/custom-hostname-api/`](https://github.com/izzywdev/FuzeInfra/tree/main/services/custom-hostname-api)
and runs cluster-internal at
`http://custom-hostname-api.fuzeinfra.svc.cluster.local:8080`.

## Why vendor instead of fetching at build time

`custom-hostname-client/` generates its types with
`openapi-typescript services/custom-hostname-api/openapi.yaml`. If that path
resolved over the network to FuzeInfra `main`, an upstream edit would silently
reshape our client on the next CI run — a contract change would land as a
mysterious type error in an unrelated PR instead of as a deliberate bump. The
commit pin in [`UPSTREAM.json`](./UPSTREAM.json) makes the upgrade an explicit,
reviewable act.

## Updating the pin

1. Read the upstream diff — FuzeInfra's `tests/test_contract.py` asserts the
   running service matches this file, so an upstream change is real.
2. Copy the new `openapi.yaml` here and update `commit` + `vendoredAt` +
   `contractVersion` in `UPSTREAM.json`.
3. `cd custom-hostname-client && npm run gen:types && npm run lint:contract`.
4. Fix whatever breaks. Type errors here are the point of the pin.

## Contract notes for FuzeFront

- **Errors carry a stable `error` code — branch on that, never on `message`.**
- **`active` is the only field to gate on** before advertising a domain to a
  user. `dns_status` / `tls_status` are for display; `provider.*` is a debugging
  passthrough explicitly outside the frozen contract and must never be branched
  on.
- Poll `GET` every 10s for the first 2 minutes, then every 60s, and stop on a
  terminal state. Each `GET` costs a Cloudflare API call upstream.
- Domains inside `fuzefront.com` are rejected with `422` — they are already
  served by the wildcard rule in `deploy/helm/fuzefront/templates/ingress.yaml`.

## Known divergences filed back to FuzeInfra

| # | Issue |
|---|-------|
| 1 | `429 quota_exceeded` is in the `Error.error` enum and documented in `CUSTOM_DOMAINS.md` §4.7, but is **not declared as a response** on `POST /custom-hostnames`. A generated client cannot type it. `CustomHostnameApiError` handles it by status code regardless. |
| 2 | `Verification.records[].purpose` is optional in the schema (`required: [method, record, value]`) but the UI guidance in `CUSTOM_DOMAINS.md` §4.4 requires rendering all three records *by purpose*. Our renderer falls back to inferring purpose from the record name. |
