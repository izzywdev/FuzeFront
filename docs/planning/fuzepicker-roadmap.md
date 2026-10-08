# FuzePicker roadmap

## Product position

FuzePicker is the browser-native collaboration surface for FuzeFront: a sender selects a live component, names an email recipient, and leaves a durable, contextual message. The recipient signs in or signs up to FuzeFront, connects the extension, and sees every mention in one place.

## Delivered in the first vertical slice

- Chrome MV3 extension capture mode: URL, deterministic XPath, recipient email, and message.
- Authenticated FuzeFront mention API, recipient-email access control, read state, and replies.
- Transactional email using the existing event pipeline, with a FuzeFront deep link.
- FuzeFront **Mentions** view that shows the sender/message and, when selected, the URL, XPath, reply field, and open-page action.
- Browser-to-FuzeFront session handoff on the Mentions page; no extension-specific account is introduced.
- Email deep links retain their FuzePicker destination across sign-in or sign-up.

## Next milestones

1. **Invitation completion:** publish the Chrome Web Store install URL and make the post-sign-in install/connect step an explicit one-click flow for a new recipient.
2. **Conversation UX:** expose sender-side sent mentions and reply notifications, thread history, resolve/archive state, and mention-count badge.
3. **Reliable targeting:** add a CSS selector plus DOM fingerprint and screenshot thumbnail; XPath alone can become stale after page redesigns.
4. **Team governance:** organizations, role-aware sharing, retention settings, audit events, and domain allow/deny rules.
5. **Production readiness:** API contract generation, integration/e2e tests against Chrome, telemetry, email delivery retries, rate-limit metrics, and a Web Store privacy review.

## Important constraint

A website cannot silently install or enable a Chrome extension. The sign-in link can connect an extension that is already installed; the next milestone adds an explicit install/enable step for users who do not yet have it.
