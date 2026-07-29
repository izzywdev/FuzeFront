# App suites, multi-surface modes, and where "mobile" is declared

Status: contract landed, runtime follow-ups open (see [Follow-ups](#follow-ups)).

## The bug that started this

FuzeHub ships **four** independently-mountable Module-Federation remotes —
`packages/fuzehub-{talent,recruiter,ventures,marketplace}/`, each exposing `./App`
with its own scope — plus an admin/management surface that does not exist yet.

When FuzeHub was onboarded to the app registry, it got **one** `registration/manifest.json`,
because that is all the contract could express. The four surfaces collapsed into a
single `iframe` entry pointing at the Next.js app.

Nothing failed. No gate went red. The product simply lost four of its five portal
entries, and the only reason it still worked in production is that a *legacy* Helm
job (`register-apps-job.yaml`, predating the onboarding kit) was still POSTing those
four to the older `/api/apps/register` endpoint. The modern, "correct" registration
path was the lossy one.

That is the shape of the defect worth naming: **the contract could not describe the
product, so onboarding quietly described a smaller product instead.**

## Why one row per surface, not one row with a list

`roles`, `visibility`, `integration`, and `nav` are all **per-surface**. A recruiter
surface and a talent surface want different roles and may want different sections. A
single registry row cannot hold five `integration` blocks or five `roles` arrays.

Two shapes were considered:

- **`apps[]` nested inside one manifest** — the parent holds identity, children hold
  the rest. But every field that differs per surface has to be repeated inside the
  array, at which point it is one-row-per-surface with extra nesting, plus a new
  fan-out rule for policy, activation, and status.
- **One manifest per surface** (chosen) — each is a complete, independently valid
  `AppManifest`. Zero new semantics for the registry: a surface is just an app.

The only thing the second shape loses is the *grouping*: five flat siblings in the
menu with nothing tying them together. That is what `nav.suite` restores, and it is
purely presentational — it changes how the menu renders, never what is registered or
authorized.

A third option — `chrome.menu: "substitute"`, which already exists — was rejected. It
lets an active app replace the portal menu with its own items, but the surfaces are
then invisible until you have already entered the product, and individual surfaces
cannot be role-gated. It solves in-app navigation, not portal presence.

## `nav.suite`

```jsonc
"nav": {
  "section": "plan",
  "order": 10,                                  // rank WITHIN the suite
  "suite": { "id": "fuzehub", "label": "FuzeHub", "order": 20 }  // rank OF the suite
}
```

Sorting is **section → `suite.order` → `nav.order`**, ties broken on `slug` so the
result is total and stable.

Every sibling carries its own copy of the suite block rather than the platform holding
a central suite table. This is the same principle that already governs `nav.section`:
*onboarding a product must never require a FuzeFront edit.* A central table would mean
every new suite is a PR against this repo.

The cost is that siblings can disagree. Rather than pick arbitrarily, the host resolves
deterministically — lowest `suite.order` wins, ties on the alphabetically-first `slug` —
and `register.sh` logs each surface's suite id at registration so a typo that silently
splits a group into two is visible in the pod log.

## `modes[]` — surfaces are not mutually exclusive

`mode` was a scalar, `portal | standalone`. That cannot say what is true of most
products: **the same app is served in the portal on desktop/web, and standalone on its
own host so that a mobile build has something to wrap.**

It was also not even read. `backend/src/routes/appRegistry.ts` *derived* it:

```ts
const mode = row.integration_type === 'module-federation' ? 'portal' : 'standalone'
```

So a manifest's declared `mode` was decorative on that path — the integration type
decided it.

```jsonc
"mode": "portal",                      // deprecated, still required, = modes[0]
"modes": ["portal", "standalone"]      // authoritative; first entry is the default
```

`mode` stays required so every existing manifest keeps validating; `modes` wins when
both are present.

### `embed` — the third surface

`embed` is an app rendered inside a **third-party** page via an SDK, with neither portal
chrome nor FuzeFront navigation. FuzeBI is the existing example (registered as a
non-registering embed SDK). An embed-only product is not a portal destination and may
not register a menu entry at all.

## Mobile requires standalone — as a member, not as an alternative

To be precise, because the earlier phrasing was ambiguous: the rule is
`"standalone" ∈ modes`, **not** `modes == ["standalone"]`.

`["portal", "standalone"]` + mobile is the *normal* case, and the intended one: the app
is mounted inside FuzeFront on desktop and web, and the very same app is separately
reachable on its own host, which is what the APK wraps.

The reason standalone must be present at all is mechanical, not philosophical. A TWA is
a browser pointed at a URL with no portal chrome around it. An app that exists *only* as
a federated remote inside the shell has no such URL — there is nothing for the store
listing to open. So `standalone` in `modes` plus a `routing.host` is exactly the
statement "there is a URL that stands on its own," which is the precondition for a
mobile build and nothing more.

## Hostnames

| Surface | Host | Why |
|---|---|---|
| standalone (and mobile) | `fuzehub.fuzefront.com`, plus custom domains like `fuzehub.com` | User-facing, memorable, what an app-store listing points at |
| portal `remoteEntry` | `fuzehub.prod.fuzefront.com` | Infra-convention host; `*.prod.fuzefront.com` is the Cloudflare-Tunnel wildcard |

`routing.host` already existed for exactly this and needed no change.

Note `remoteEntry` is fetched by the **browser**, not server-side — so the
`*.prod.fuzefront.com` host is still public and CORS-reachable. It is a different
convention, not a private network.

## Where each capability is declared

This is two manifests with two different audiences, and conflating them is easy:

| File | Audience | Holds |
|---|---|---|
| `registration/manifest.json` (+ `apps/*.json`) | **FuzeFront at runtime** | Portal identity: `slug`, `menuLabel`, `icon`, `nav`, `modes`, `integration`, `routing`, `roles` |
| `.fuze/manifest.json` | **Maintainer agents in CI** | Capability surface: `agents`, `mcp`, `a2a`, `hardening`, `dependsOn` |

The maintainer agents (`mcp-maintain.yml`, `a2a-maintain.yml`) run on `pull_request` in
each consuming repo, read `.fuze/manifest.json`, and reconcile the declared block
against what is actually in the tree — building the surface the first time and
correcting drift after.

**`mobile` therefore belongs in `.fuze/manifest.json`**, alongside `mcp` and `a2a`, and
`mobile-maintainer` becomes the third sibling of that pattern:

```jsonc
"mobile": {
  "enabled": true,
  "platforms": ["android"],
  "applicationId": "com.fuzefront.fuzehub",
  "standaloneSlug": "fuzehub-ventures"
}
```

It is the one block that must **cross-reference the other manifest**: the URL to wrap
lives in `registration/`, not `.fuze/`. So the gate is a pair check — `mobile.enabled`
requires the referenced registration manifest to declare `standalone` in `modes` and a
`routing.host`. That is deliberately the only coupling between the two files, and it is
one-directional.

## Worked example — FuzeHub

```
registration/
  manifest.json          slug: fuzehub-ventures    (primary; owns policy + billing)
  policy.json
  apps/
    talent.json          slug: fuzehub-talent
    recruiter.json       slug: fuzehub-recruiter
    marketplace.json     slug: fuzehub-marketplace
    admin.json           slug: fuzehub-admin       (surface does not exist yet)
```

All five share `nav.suite.id = "fuzehub"`. Each portal surface points its
`integration.remoteEntry` at its own built remote; `routing.host` is
`fuzehub.fuzefront.com` for the standalone surface.

`manifest.json` remains the **primary**: `policy.json` and `billing-profile.json` are
per-*product*, not per-surface, so binding them to a fixed slug removes any ambiguity
about which sibling owns them.

### On federating the Next.js app

FuzeHub's `frontend/` is Next 15 App Router on React 19. Federating it was considered
and rejected for three concrete reasons:

1. The host shares React `^18.3.1` as a singleton; the Next app is React `^19`. One
   singleton cannot span both.
2. The host uses `@originjs/vite-plugin-federation`; the remotes use
   `@module-federation/vite`. Different runtimes, interop unverified.
3. App Router + `@module-federation/nextjs-mf` is not a paved path (the RSC boundary).

None of it is necessary, because the four Vite remotes are *already* React 18 MF
remotes. The clean split is **portal → the remotes, standalone → the Next.js app,
mobile → a TWA over the standalone URL**. The iframe integration goes away, which was
the actual objection.

The honest cost: `frontend/app/marketplace/` and `frontend/app/ventures/` are Next pages
covering the same ground as the marketplace and ventures remotes. Measured, the literal
duplication is small — the four remotes total ~577 lines and are static mock data with
host-injected auth (`window.__FUZE_AUTH__`), while the Next pages total ~1348 lines with
real auth wiring (`SimpleAuthProvider`) and no data fetching. They share no code and
neither is finished. So this is duplicated *product surface*, not duplicated
implementation — cheap to reconcile now, expensive once both are real.

## Follow-ups

Not in the contract PR, each independently shippable:

1. **Backend reads `modes`** instead of deriving mode from `integration_type`
   (`backend/src/routes/appRegistry.ts`). Needs a migration for the stored column.
2. **Shell renders suite groups** in the side menu. This is feature UI, so it goes
   through the design-frames flow first. Until it lands, siblings render as flat
   entries — correct, just not grouped.
3. **`mobile-maintainer`** in FuzeSDLC, plus the `mobile` block and its paired gate,
   generalizing FuzeFront's existing `build-android-apk.yml`.
4. **FuzeHub migration** to five manifests, and retiring `register-apps-job.yaml` — in
   that order. The legacy job is the only thing registering those four surfaces today
   and must not be removed before its replacement is live.
5. **`modes` sweep** across the remaining product repos.
