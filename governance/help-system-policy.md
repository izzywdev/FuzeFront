# FuzeFront Help System Policy

> **Status:** Active. **Owner:** `@izzywdev`. **Tier:** product (FuzeFront overlay).
> **Enforced by:** `gate-help-conformance` (`.github/workflows/gate-help-conformance.yml` →
> `scripts/check-help-conformance.mjs`, config `governance/help-system-policy.json`).
> **Skill:** `.claude/skills/help-system/` operationalizes this document for authors/agents.
> **Precedence:** this policy governs the help system specifically; where it is silent, the
> FuzeFront `CLAUDE.md` overlay and the FuzeSDLC baseline govern. Platform facts (product name,
> auth, deploy model, packages, toolchain) are owned by `CLAUDE.md` — this policy points at them,
> it does not restate them, so the two cannot drift.

This is the "book" for the help system: what to build, how to write it, what must never appear,
how it is reviewed, and how it stays accurate. It is deliberately exhaustive — the help system has
already shipped badly wrong content to production once, and a vague policy is how that happens.

---

## 0. The failure this policy exists to prevent

`frontend/src/pages/HelpPage.tsx` shipped and sat in production telling every user and developer
things that were simply false:

- it called the product **"FrontFuse"** (the product is **FuzeFront**);
- it hard-coded **`http://localhost:3001`** as the API host in copy-paste `curl` examples;
- it told developers to **`npm install @frontfuse/sdk`** — a package that has never existed, under
  a scope (`@frontfuse`) that has never existed (the scope is `@fuzefront`);
- it gave **Netlify / Vercel / AWS S3+CloudFront** deployment steps for a platform that deploys
  exclusively via **Kubernetes/Helm/Argo (GitOps)**;
- it pointed support at **`support@frontfuse.dev`**, **`discord.gg/frontfuse`**, and
  **`github.com/your-org/frontfuse`** — none of which exist;
- it published a fake seed credential (`admin@frontfuse.dev` / `admin123`) as if it were a real
  login, when sign-in is Authentik SSO.

Every one of those was a **deterministic, greppable** defect. The lesson encoded throughout this
policy: **help content is code — it must be accurate, reviewed, tested in CI, and kept fresh.**

---

## 1. Principles

1. **Content-driven, single source of truth.** Help content lives as Markdown in `docs/help/**`.
   A React component never contains help prose that could instead live in the content tree. A fact
   is written once.
2. **Accurate or absent.** Nothing ships that is wrong. A missing article is recoverable; a
   confidently-wrong article is a support incident and an erosion of trust.
3. **No placeholders in published content.** No `TODO`, no "coming soon", no dead link, no stand-in
   screenshot. Unfinished content is `status: draft` and is not shown to users.
4. **Cite the source of truth, don't copy it.** When help describes a platform rule (naming,
   toolchain, auth), link to the authoritative doc (`CLAUDE.md`, a governance standard, an OpenAPI
   spec). Copies rot silently.
5. **Two audiences, clearly separated.** End users and developers have different needs; an article
   declares which it serves and is written for that reader.
6. **Works side by side with the Developer Portal.** The in-app help (`app.fuzefront.com/help`) and
   `developers.fuzefront.com` are one system: help hands developers off to the portal for live API
   catalog + sandbox; the portal links back to the conceptual guides in help. Neither contradicts
   the other.
7. **Accessible and international by default.** Alt text, semantic headings, token-based contrast,
   keyboard operability, and RTL (Hebrew) support are requirements, not enhancements.
8. **Fresh and owned.** Every article has an owner and a `lastReviewed` date; stale content is
   findable and gets re-reviewed, not left to rot.

---

## 2. Architecture

### 2.1 Source of truth
- Canonical content: `docs/help/` (see `docs/help/README.md`).
- Index of record: `docs/help/manifest.json` (schema: `docs/help/manifest.schema.json`).
- Committed media: `docs/help/_assets/` (see that directory's README).

### 2.2 Surfaces that consume it
- **In-app Help Center** — `frontend/src/pages/HelpPage.tsx`, route `/help`. It renders from the
  content tree (today it links out to it; the content-driven renderer is tracked — see §17.4).
- **Developer Portal** — `developers.fuzefront.com` (`devportal-frontend/`): live OpenAPI catalog +
  try-it sandbox. Help's developer guide explains concepts and hands off to the portal for the
  live reference.

### 2.3 What must stay in sync
When the platform changes, the help system is part of the change's definition of done
(see §18). Specifically: a renamed route, a new app, a changed auth flow, a new plan, a toolchain
floor bump, or a new/removed package obliges a help update in the same or an immediately-following PR.

---

## 3. Information architecture

### 3.1 Sections
The help system has exactly two top-level sections, each an `audience`:
- **User Guide** (`audience: user`) — using the portal.
- **Developer Guide** (`audience: developer`) — building/registering/deploying on the platform.

A third section is not added without an owner decision recorded in `manifest.json` and this policy.

### 3.2 Article taxonomy (nav order is `order` in frontmatter)
User Guide (task-oriented, in order of a new user's journey):
1. Getting started · 2. Navigating the portal · 3. Organizations & teams ·
4. Installing & using apps · 5. Account & security · 6. Billing & plans · 7. Mobile app ·
8. Getting help.

Developer Guide (concept → build → ship):
1. Overview · 2. Quickstart (build a micro-frontend) · 3. Module Federation contract ·
4. Design system · 5. Authentication & authorization · 6. Registering your app ·
7. APIs & contracts · 8. Developer Portal · 9. Deployment · 10. Troubleshooting.

### 3.3 One article = one job
An article answers one question or completes one task. If a section grows past ~130 lines or covers
two distinct jobs, split it and add both to the manifest. Do not create an article shorter than it
needs to be to stand alone — stubs are forbidden (§6).

---

## 4. Audiences

- **User**: assumes no engineering knowledge. Explains concepts in product terms, step by step.
  Never shows shell commands, config files, or API payloads.
- **Developer**: assumes a working React/Node developer. Shows config, code, and same-origin API
  calls. Still explains FuzeFront-specific rules a newcomer cannot guess (the shared-singleton
  contract, the naming rules, GitOps deploy).

An article serves exactly one audience (`audience: user` or `audience: developer`). A topic that
both need (e.g. "what is an organization") is written for users and linked from the developer guide,
not duplicated.

---

## 5. The article contract

### 5.1 File naming
- Lowercase kebab-case, `.md`: `getting-started.md`, `module-federation-contract.md`.
- Under the audience directory: `docs/help/user-guide/…` or `docs/help/developer-guide/…`.
- The file must be listed in `manifest.json` (bidirectional coverage is enforced).

### 5.2 Frontmatter (YAML) — required on every published article
```yaml
---
title: Getting Started            # human title; also the H1
description: One sentence on what this article covers and who it is for.
audience: user                    # user | developer
order: 1                          # nav order within the section
owner: "@izzywdev"                # GitHub handle, @-prefixed
lastReviewed: 2026-10-26          # YYYY-MM-DD; the last date a human verified it is still true
status: published                 # published | draft  (draft is not shown to users)
media:                            # OPTIONAL — omit if the article has no figures yet
  - { src: _assets/getting-started/01-dashboard.png, alt: "The portal dashboard", type: image }
---
```
- `media` entries are flow-maps (`{ src, alt, type }`); `type` is `image` or `video`. Local images
  resolve relative to the article; video uses an https URL on an approved host (§11.4).
- Do **not** invent extra required fields; features may add their own optional keys.

### 5.3 Body structure
- `# Title` (H1, once) matching `title`.
- A one-paragraph intro that states what the reader will be able to do after reading.
- Task sections as `##`/`###` with imperative headings ("Install an app", "Expose your component").
- Code blocks fenced with a language. API examples use **same-origin relative paths**
  (`POST /api/v1/apps`), never an absolute host.
- A short "Related" or inline cross-links to the next logical articles.

---

## 6. Voice, tone, and completeness

1. **No emojis.** The old page was decorative; this one is professional and dense.
2. **No marketing hype.** "Powerful", "seamless", "effortless", "revolutionary" — cut them. State
   what the thing does.
3. **Second person, active voice, present tense.** "Select **Apps**", not "the Apps menu can be
   selected".
4. **Short sentences; one idea each.** Prefer lists and steps over paragraphs for procedures.
5. **Define a FuzeFront-specific term on first use**, then use it consistently (organization,
   remote, host shell, slug, menu label).
6. **Complete, not aspirational.** A `status: published` article describes what exists **now**. If a
   capability is planned, do not document it as present. No `TODO`/`TBD`/`FIXME`/"coming
   soon"/`PLACEHOLDER`/`XXX` in published content (the gate fails on these; they are allowed only in
   `status: draft`).
7. **No credentials, ever** — not real, not fake, not "example" seed logins.
8. **British/American spelling**: follow the repo default (American) for consistency.

---

## 7. Accuracy and the source of truth

### 7.1 The facts that must be right (owned by `CLAUDE.md` — verify there, link there, never guess)
| Topic | Truth (as of this policy) | Canonical source |
|---|---|---|
| Product name | **FuzeFront** (never "FrontFuse") | `CLAUDE.md` |
| Portal URL | `https://app.fuzefront.com` | — |
| Developer docs | `https://developers.fuzefront.com` | `docs/planning/developers-portal.md` |
| Identity / sign-in | Authentik (OIDC SSO) — no seed email/password | `docs/AUTHENTICATION_SETUP.md` |
| Authorization | Permit.io (roles/policies); an id is never a capability | `CLAUDE.md` "Entity identifiers" |
| Deploy model | Kubernetes/Helm/Argo (GitOps); merge-to-master deploys; no hand-deploy; no Netlify/Vercel/AWS | `CLAUDE.md` "Hardening / signing" |
| Package scope | `@fuzefront/*` (and `@fuzeone/*` for some clients). **No `@fuzefront/sdk`, no `@frontfuse/*`.** | `packages/*/package.json` |
| Toolchain floor | Node ≥24, React `^19.2.0`, MF shared `requiredVersion ^19.0.0` (host = remote) | `CLAUDE.md` "Toolchain baseline" |
| API base | Same-origin; never hard-code an absolute API host | `CLAUDE.md` "What FuzeFront is" |
| Design system | Extend `@fuzefront/design-system` ("fuse seam"); tokens only | `CLAUDE.md` "Design system" |
| Naming (slug/menuLabel/serve-path) | Three independent questions; slug immutable; menuLabel drops "Fuze"; serve path independent | `CLAUDE.md` "slug, display name, and the federated serve path" |
| Repo | `izzywdev/FuzeFront` | — |

### 7.2 Rules
1. **Cite, don't copy.** Link the canonical source; summarize only what the reader needs.
2. **If you are not sure a fact is current, verify it in the repo before publishing** — read the
   code/config, don't reproduce a memory or an old doc.
3. **When the platform changes, the help change ships with it** (§18).
4. The **forbidden terms and URL patterns** in `governance/help-system-policy.json` encode the
   known-wrong facts. Add to that list whenever a new wrong-but-greppable fact is found.

---

## 8. Forbidden terms and URLs (enforced)

The authoritative, machine-checked list is `governance/help-system-policy.json`
(`forbiddenTerms`, `forbiddenUrlPatterns`). It currently blocks, among others: `FrontFuse`,
`frontfuse.dev`, `@frontfuse/`, `@frontfuse/sdk`, `localhost:3001`, `admin@frontfuse.dev`,
`admin123`, `your-org/frontfuse`, `discord.gg/frontfuse`, `docs.frontfuse.dev`, and any
`http(s)://localhost`, `127.0.0.1`, `example.*`, or `your-…` placeholder host.

- These apply to **both** the content tree and `HelpPage.tsx`.
- To legitimately mention an old name (e.g. a changelog), add an `allowIn` glob to that term's entry
  in the JSON — the exception is reviewed in the PR, not silent.

---

## 9. Cross-linking

1. **Internal links must resolve.** Relative Markdown links point only to files that exist (the
   gate checks this). Prefer relative links between articles over absolute URLs.
2. **Hand off to the Developer Portal** for anything live: the API catalog, a spec, the try-it
   sandbox → link `https://developers.fuzefront.com`.
3. **Point to `CLAUDE.md` / governance docs** for platform rules rather than restating them.
4. **Every article links onward** to the next logical article(s) so the reader is never stranded.
5. Do not link to a localhost or placeholder host (gate-enforced).

---

## 10. Media standard (screenshots, diagrams, video)

Media makes help concrete, but bad media is worse than none. **No fake or placeholder media is ever
committed** (§6.6 of the gate). Production of real media is tracked as work (Jira), not faked in-repo.

### 10.1 Screenshots
1. **Where**: `docs/help/_assets/<article-slug>/<ordinal>-<description>.png` (e.g.
   `01-dashboard-overview.png`). Reference from frontmatter `media:` with `type: image`.
2. **Format**: PNG for UI screenshots, `.webp` acceptable; **SVG for diagrams**. No `.bmp`/`.tiff`.
3. **Resolution**: capture at a 2× (retina) logical width of ~1280px; export so the committed file
   is ≤ **500 KB** (the gate's `media.maxImageKB`). Compress (pngquant/oxipng) before committing.
4. **Redaction**: no real customer data, no personal data, no tokens/keys/URLs with secrets, no
   real email addresses. Use seeded demo data. A screenshot is published content — treat it like
   published text.
5. **Chrome**: capture the relevant UI with enough surrounding context to orient; crop ruthlessly to
   the subject. Light theme by default unless the article is about theming.
6. **Annotation**: if you mark up a screenshot (arrows, numbered callouts), use the design-system
   accent tokens, not arbitrary colors, and describe each callout in the body text (don't rely on
   the image alone — accessibility).
7. **Alt text**: every image has non-empty `alt` describing what it shows and why it matters, not
   "screenshot" (gate-enforced).
8. **Freshness**: when the UI changes, the screenshot is stale. A screenshot older than its
   article's `lastReviewed` must be re-checked at review time.

### 10.2 Diagrams
- Author as SVG (hand-written or exported); keep them token/theme-aware where possible so they read
  in light and dark. Architecture diagrams should match the real architecture (`CLAUDE.md`,
  `docs/Runtime_Module_Federation_Architecture.md`).

### 10.3 Screencasts / video
Short task walkthroughs (≤ 2–3 minutes) are encouraged for multi-step flows.
1. **Scope**: one task per clip; narrated or captioned; no background music hype.
2. **Capture**: record the real app against seeded demo data; 1280×720 or 1920×1080; redact as §10.1.4.
3. **Editing / polish**: trim dead time, add captions/callouts. (Note: AI language models such as
   Opus can help **script, storyboard, caption, and write the narration** for a screencast; they do
   **not** record or video-edit — the recording and the cut are produced with a screen recorder and
   a video editor by whoever is assigned the task.)
4. **Hosting**: video is **not committed to git**. Host it on an approved host
   (`governance/help-system-policy.json` → `media.videoAllowedHosts`) and reference it in frontmatter
   with `type: video` and an https URL. Provide a text transcript or captions for accessibility.
5. **Accessibility**: captions are required; a clip must not be the only way to learn a task — the
   article's prose stands alone without it.

### 10.4 The "where needed" test
Add media only where it genuinely helps a reader: a non-obvious UI location, a multi-step flow, a
before/after. Do not screenshot every button. Prose that can stand alone must stand alone.

---

## 11. Accessibility

1. **Alt text** on every image; captions/transcript on every video (gate-enforced for `alt`).
2. **Semantic headings** — one H1, properly nested H2/H3; no skipped levels; the heading text is the
   section's job.
3. **Contrast & color** — the help UI uses design-system tokens (§13); never rely on color alone to
   convey meaning (pair it with text).
4. **Keyboard** — the help UI (tabs, nav, links) is fully keyboard-operable and focus-visible.
5. **Link text is descriptive** — "see the Module Federation contract", not "click here".
6. **Plain language** for users; expand an acronym on first use.

Independent runtime a11y verification uses the `ui-runtime-validation` skill /
`chrome-devtools-mcp` a11y tooling when the help UI changes.

---

## 12. Internationalization (i18n)

1. FuzeFront ships **English and Hebrew (RTL)**. Help UI chrome (tab labels, buttons) comes from the
   i18n system (`packages/i18n`, `frontend/src/contexts/LanguageContext`), not hard-coded strings.
2. Article **content** is authored in English today; the content model (frontmatter + manifest) is
   structured so a `lang` variant can be added per article without changing the UI. Do not hard-code
   English UI chrome in `HelpPage.tsx`.
3. Write content that **translates cleanly**: short sentences, no idioms, no text baked into images
   (put labels in the caption/body so they can be translated).
4. Layout must not break under RTL — the help UI uses logical CSS properties / design-system
   primitives that already handle direction.

---

## 13. Design-system conformance (the help UI)

1. `HelpPage.tsx` and any help component use **`@fuzefront/design-system` tokens and primitives
   only** — no raw hex, px, or font values (enforced by `gate-ds-conformance`).
2. A missing primitive is added to the design system via its own skill, not one-off styled in the
   help page.
3. **Design-first gate applies to help UI.** A structural change to the Help Center UI
   (new layout, new navigation, content-driven renderer) requires approved frames
   (`design/frames/help/**`) authored by `product-designer` in a **frames-only PR** before the UI is
   built (`CLAUDE.md` "Design-first gate", `gate-frames-first`). Fixing wrong **content** in place is
   a correctness fix and does not require new frames.
4. **Runtime validation**: any help UI change is verified console-clean in a real browser via the
   `ui-runtime-validation` skill before it is called done.

---

## 14. Versioning and changelog

1. `manifest.json` carries a SemVer `version` for the help content set; bump it when the content set
   changes materially (new section, restructured nav).
2. Significant help changes are described in the PR; a user-facing "what changed" note belongs in the
   relevant article, not a separate changelog, unless a changelog article is later added to the
   manifest.
3. When documenting a capability gated by a **feature flag**, state the flag and that it is rolling
   out; don't document a default-OFF capability as generally available.

---

## 15. Freshness and maintenance

1. Every article has `owner` and `lastReviewed`. **Touching an article for a real change resets
   `lastReviewed` to today** — but only after verifying the whole article is still true, not just
   the edited line.
2. **Review cadence**: every article is re-verified at least every **180 days** (the gate's
   `freshness.days`). The gate reports articles past that age.
3. **Freshness ramp**: `freshness.mode` starts at `warn` (report, don't block) and flips to `fail`
   once the stale backlog is zero and the owner (`@izzywdev`) accepts that any PR touching a stale
   article must re-review it. This mirrors the `gate-ds-conformance` / `gate-frames-first` ramps.
4. A quarterly sweep (or the `governance-reconciliation` cadence) checks screenshots against the
   current UI and external links via the `doc-validity` skill.

---

## 16. Roles and ownership

- **Content (`docs/help/**`)** — `docs-maintainer` authors and maintains; feature-owning agents
  supply the facts for their feature's article.
- **Help UI (`HelpPage.tsx`, help components)** — `frontend-engineer` (desktop) /
  `mobile-frontend-engineer` (mobile), design-system-first.
- **Help UI design frames (`design/frames/help/**`)** — `product-designer` only (frames-only PRs).
- **Media production** — assigned per task (screenshots/screencasts); AI assists with
  scripting/captions only (§10.3).
- **Policy, gate, skill** — `platform-governance` / `docs-maintainer` under owner `@izzywdev`.
- **Developer Portal** — `devportal-service` / `devportal-frontend` owners; help cross-links, it
  does not own the portal.

---

## 17. Governance and enforcement

### 17.1 The gate
`gate-help-conformance` runs on every PR touching `docs/help/**`, `HelpPage.tsx`, the policy JSON,
the script, or the workflow. Config: `governance/help-system-policy.json`.

### 17.2 Hard failures (never rampable)
Forbidden terms; placeholder/localhost/example URLs in a published surface; placeholder markers in a
`status: published` article; missing/invalid frontmatter; manifest↔disk coverage mismatch; broken
internal relative link; referenced media that is missing, 0-byte, over budget, or missing alt text.

### 17.3 Ramp
Article **freshness** (`freshness.mode`: `warn` → `fail`). This is the only rampable check.

### 17.4 Running it locally
```bash
node scripts/check-help-conformance.mjs --all          # scan the whole surface
node scripts/check-help-conformance.mjs --files X.md    # specific files
node --test scripts/__tests__/check-help-conformance.test.mjs   # the gate's own tests
```

### 17.5 Known follow-on work (tracked in Jira, not in scope of the gate landing)
- The content-driven **renderer** in `HelpPage.tsx` (render Markdown from the tree at runtime)
  requires `product-designer` frames + `ui-runtime-validation`; it ships in its own PR(s).
- **Media production** (real screenshots + screencasts) is tracked per article.
- Per-article **Hebrew translations**.

---

## 18. Definition of Done — a help change

A help change is done when ALL of:
- [ ] Content is accurate to the current platform (§7), with no forbidden term/URL/placeholder.
- [ ] Frontmatter is complete and valid; `lastReviewed` is today; `status` is correct.
- [ ] The article is listed in `manifest.json` (and nothing is orphaned/dangling).
- [ ] Internal links resolve; it hands the reader onward (§9).
- [ ] Any media exists, is redacted, compressed, under budget, and has alt text/captions (§10–11).
- [ ] `node scripts/check-help-conformance.mjs --all` passes locally.
- [ ] If the help **UI** changed structurally: approved frames exist, DS-conformant, runtime
      console-clean (§13).
- [ ] The PR is non-draft with the `auto-merge` label (`CLAUDE.md` branch policy).

A platform change (new route/app/plan/flow, toolchain bump, package add/remove) is **not done** until
the affected help article is updated in the same or an immediately-following PR.

---

## 19. How to add or update an article (quick procedure)

1. Decide the audience and where it fits (§3). Pick a kebab-case filename.
2. Copy the article template from the `help-system` skill; fill frontmatter (§5.2).
3. Write the body (§5.3, §6); verify every fact against its source (§7).
4. Add the article's repo-relative path to the right section in `manifest.json`.
5. Add media only where it helps (§10); commit images under `_assets/<slug>/`; host video.
6. Run the gate locally (§17.4); fix every failure.
7. Open a non-draft PR with `auto-merge`; if the UI changed structurally, split frames into their
   own PR first (§13.3).
