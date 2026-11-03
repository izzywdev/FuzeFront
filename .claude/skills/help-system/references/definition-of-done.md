# Help change — Definition of Done

Copy into the PR description and check each box.

- [ ] Content is accurate to the **current** platform (policy §7); every fact verified against its
      source, not memory.
- [ ] No forbidden term/URL/placeholder (gate-help-conformance passes).
- [ ] Frontmatter complete and valid; `lastReviewed` = today; `status` correct.
- [ ] Article listed in `docs/help/manifest.json`; nothing orphaned or dangling.
- [ ] Internal links resolve; the article hands the reader onward (and to the Developer Portal where
      live reference is needed).
- [ ] Any media exists, is redacted (no real data/tokens), compressed ≤500 KB, has `alt`
      text/captions; video is hosted (not committed) on an approved host.
- [ ] `node scripts/check-help-conformance.mjs --all` passes locally.
- [ ] `node --test scripts/__tests__/check-help-conformance.test.mjs` passes.
- [ ] If the help **UI** changed structurally: approved `design/frames/help/**` exist (frames-only
      PR landed first), DS-conformant, runtime console-clean (`ui-runtime-validation`).
- [ ] PR is non-draft with the `auto-merge` label.
- [ ] If this documents a platform change, the platform change and this help update ship together.
