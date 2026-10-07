# Connector production UX evidence

`frontend/e2e/post-prod/connectors-catalog-smoke.spec.ts` runs in the existing
`Post-prod E2E (live smoke)` workflow and its post-deploy reusable invocation.
It signs in with the existing `POST_PROD_EMAIL` / `POST_PROD_PASSWORD` synthetic,
opens Connectors from the dashboard navigation, and checks the live ingress.
Missing credentials fail this coverage instead of silently skipping it.

The release floor is Gmail plus the 25 implemented generic providers from
roadmap waves 1, 2, and the five implemented wave-6 providers. A stale backend
catalog fails even if its frontend faithfully displays only one provider.
Every additional catalog entry is checked too. Extend the explicit ID floor
when another batch ships; planned providers are not counted as released.

Each card must have a unique heading, a successful authenticated metadata
response, a valid status, and matching controls. Setup-pending providers must
remain visible with disabled controls. The test does not authorize a provider,
save a key, disconnect an account, or alter configuration. Provider setup
pending is a valid visibility state, not proof of a working provider grant.

The workflow uploads `post-prod-playwright-report` for 14 days, containing
per-provider screenshots, a full-page inventory screenshot, a JSON inventory
without tokens/identity emails, the successful browser video, and a 3-fps MP4.
Traces are disabled for this journey to avoid publishing session headers.
Screenshots/video show the synthetic account's UI, so artifact access should
be limited to repository collaborators.

Run against production after rollout:

```sh
cd frontend
npx playwright test --config playwright.post-prod.config.ts connectors-catalog-smoke.spec.ts
```

A committed test or successful fixture run is not production evidence. Verify
the real post-deploy run and its artifacts before claiming all connectors are
visible in production. This test proves catalog/UI/metadata health, not OAuth
consent, provider action execution, or marketplace publication.
