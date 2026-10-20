# Newcomer Task Ideas

These are intentionally small contribution surfaces for people discovering FuzeFront.

1. Verify the development quickstart on clean Ubuntu.
2. Verify the development quickstart on clean Windows.
3. Verify the development quickstart on macOS.
4. Find and fix FrontFuse/FuzeFront naming drift in public docs.
5. Add a minimal external-app registration example.
6. Add a minimal iframe integration example.
7. Add a minimal Web Component integration example.
8. Improve first-run error messages for missing dependencies.
9. Add accessibility checks for the app selector.
10. ~~Audit Hebrew/RTL documentation and UI examples.~~ Done (#1025) —
    `docs/guides/BUILDING_ON_FUZEFRONT.md` § "Internationalization & RTL" now
    has a consuming-app example; `packages/i18n/README.md` was verified
    accurate against source.
11. Add a troubleshooting decision tree for registration failures.
12. Document how to remove/unregister an app cleanly.
13. Add a lightweight architecture comparison page.
14. Add a public non-goals page.
15. Improve contributor verification instructions with expected output.
16. Add RTL/logical-properties guidance to `design-system/readme.md` — it
    currently says nothing about direction even though the components it
    ships are expected to use CSS logical properties (found during #1025;
    out of scope there since that audit covered consuming-app docs, not the
    base design system's own doc).
