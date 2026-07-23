# FuzeQuality GitHub App

Register one organization-owned GitHub App for repository discovery and scanning.
FuzeQuality exchanges the App private key for short-lived installation tokens; it
does not accept personal access tokens or credential-bearing repository URLs.

## Registration contract

Use the following repository permissions and no organization or account permissions:

| Permission | Access |
|---|---|
| Metadata | Read-only (GitHub-required baseline) |
| Contents | Read-only |
| Pull requests | Read-only |

Subscribe the webhook to:

- `push` — only pushes to the onboarded default branch enqueue an exact-SHA scan;
- `repository` — default-branch edits, renames, and transfers enqueue reconciliation;
- `installation` — newly installed repositories enqueue reconciliation;
- `installation_repositories` — repositories added to an installation enqueue reconciliation.

Set the webhook URL to `https://<FuzeQuality host>/api/v1/webhooks/github`, enable
SSL verification, and generate a high-entropy webhook secret. Seal the App ID,
PEM private key, and webhook secret as `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`. A missing secret fails
closed; the endpoint never accepts unsigned payloads.

Install the App only on explicitly selected `Fuze*` repositories. Repository
onboarding stores the numeric installation ID and credential-free canonical URL.
Installation tokens stay in worker memory and are sent to Git through an ephemeral
HTTP header. Diagnostics redact token-like values and credential-bearing URLs.

## Operational verification

1. Deliver a GitHub webhook test and confirm HTTP `202` with `queued: 0`.
2. Push to a non-default branch and confirm no scan command is queued.
3. Push to the default branch and confirm one scan command contains the exact `after` SHA.
4. Rotate the webhook secret and App private key independently; update the sealed
   secret through the normal FuzeInfra GitOps process.
