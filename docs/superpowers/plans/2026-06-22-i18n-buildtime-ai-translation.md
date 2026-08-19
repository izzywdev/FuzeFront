# i18n — Build-time AI translation + Language Selector (`@fuzefront/i18n`)

Status: **plan (for review)**. Implementation artifacts listed at the end.

## Context

FuzeFront ships UI in English only. We want multi-language support without hand-maintaining many
locale files: authors maintain **English**, a curated list of ~10 major languages is translated by
**AI at build time**, and the results ship to production through normal CI/CD. Adding a language =
add it to the list → CI translates → PR → ship. Must support **RTL + LTR**, stay **self-hosted /
decoupled** (reuse the existing **LiteLLM gateway**), and deliver the runtime as a **private npm
package** the frontend container imports.

Decision (locked with the user): **build-time, not runtime.** No on-the-fly "Translating…" flow, no
runtime translation microservice, no runtime DB. This deliberately trades instant new-language
availability for far less complexity; a new language is a list edit + rebuild + short CI/CD.

## Library & Architecture Review (summary)

Adopt **`i18next` / `react-i18next`** for the runtime (de-facto standard; RTL, ICU plurals, lazy
namespace loading, huge ecosystem) — never build that. Don't adopt a full TMS:
[Tolgee](https://tolgee.io/) (self-host) and [locize](https://www.locize.com/i18next/) (SaaS, by the
i18next team) both do "maintain English → auto-translate → deliver," but Tolgee is a heavy extra
stateful service and locize is external SaaS (clashes with self-hosted/decoupled, costly at scale).
Our build-time flow is simple enough to own on top of i18next + the LiteLLM gateway we already run,
with **no lock-in**. Runner-up: Tolgee self-hosted, if we later want translator UI / in-context
editing.

## Components (componentized, private)

1. **`@fuzefront/i18n`** — npm package (private; `publishConfig` → GitHub Packages `@fuzefront`,
   `access: restricted`, `repository` field; wired into the release pipeline). The frontend container
   imports this. Public interface:
   - `<I18nProvider>` — initializes i18next, loads bundled locale JSON, restores the saved language.
   - `<LanguageSelector>` — **design-system-first** component (fuse-seam tokens; states/variants/a11y;
     keyboard + screen-reader labels).
   - `useT()` / re-export of `useTranslation`; `setLanguage(lng)`; `useDir()` + a `dir()` manager that
     sets `<html dir>` and `lang`.
   - Internal: i18next config, the language registry (code → name, native name, `dir`), locale JSON
     loading. RTL handled centrally; **design-system components must use CSS logical properties**
     (`margin-inline`, `padding-inline-start`, `inset-inline`…) so they mirror automatically.
2. **`@fuzefront/i18n-translate`** — a small build-time CLI (bin) in the same repo: reads the English
   source bundle + the configured language list, diffs against existing locale files, asks the
   **LiteLLM gateway** (OpenAI-compatible `/chat/completions`) to translate only **missing/changed**
   keys (preserving ICU placeholders + not translating interpolation tokens), and writes the locale
   JSON. Idempotent, content-hash keyed; no network on normal builds.

## Translation pipeline (CI, build-time)

- **English source of truth**: a canonical `locales/en/*.json` (namespaces) extracted from the
  design-system + apps. The language list lives in one config (e.g. `i18n.languages.json` with code +
  `dir`).
- **`.github/workflows/i18n-translate.yml`**: triggers on changes to `locales/en/**` or the language
  list (and manual `workflow_dispatch`). Runs `@fuzefront/i18n-translate` against LiteLLM (key via CI
  secret), then **opens a bot PR** with the regenerated `locales/<lng>/*.json`. Translations are thus
  reviewable, diffable, and versioned. Merge → the normal frontend build bakes them in and the
  existing release/Argo pipeline ships them. **No translating on every build** (cost/determinism).
- Quality guards: never translate ICU/interpolation tokens or keys; keep a per-key source-hash so only
  changed English re-translates; optional glossary/do-not-translate list (brand terms like "FuzeFront",
  "fuse seam").

## Storage (reevaluated for build-time)

**Git is the store.** Generated locale files are committed (via the bot PR) and bundled into the
frontend image. No runtime DB, no CDN, no runtime service. Versioned + reviewed + reproducible.

## Integration

- **Converge identity-ui i18n onto `@fuzefront/i18n`.** The identity track (#65) began an en/he RTL
  i18n provider; that should consume this package instead of rolling its own — single source of i18n
  truth across the container and all microfrontends (shared MF singleton like react).
- Frontend container mounts `<I18nProvider>` at the root and `<LanguageSelector>` in the top bar.

## Deploy / CI wiring (part of "done")

- `@fuzefront/i18n` + `@fuzefront/i18n-translate`: private publish-config + repository + added to the
  lerna/release publish pipeline (same as other `@fuzefront/*` packages).
- `i18n-translate.yml` workflow added; LiteLLM endpoint + key as CI secrets (the gateway is in-cluster;
  CI reaches it via the same mechanism chat-service uses, or a build-time-only key).
- No new service/Argo app — locale files ride the existing frontend image + release pipeline.

## Out of scope / deferred
- Runtime/on-demand new-language generation + "Translating…" spinner (explicitly dropped; revisit only
  if product needs instant arbitrary languages).
- Translator UI / in-context editing (would be the Tolgee path).
- Human review/QA workflow beyond PR review of the generated files.

## Verification
- `@fuzefront/i18n`: unit tests (vitest) for provider/selector/dir; type-check; library build (es/cjs/dts);
  a11y check on `<LanguageSelector>`; visual RTL flip check (he/ar).
- `@fuzefront/i18n-translate`: unit tests with a **mocked** LiteLLM (no live calls); idempotency test
  (no changes → no rewrite); ICU-placeholder-preservation test.
- `i18n-translate.yml`: `actionlint`; a dry-run that produces a no-op PR when nothing changed.
