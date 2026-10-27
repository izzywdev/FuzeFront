# Marketplace readiness — audited 2026-10-05

These are source-code findings, not observations of provider accounts or production installations. No listing is confirmed published.

| Provider | Implemented | Missing code/assets | External evidence or access required |
| --- | --- | --- | --- |
| Slack | OAuth connector, read actions, publisher role and review packet | In-Slack user-facing functionality; distributable Slack app configuration; listing graphics, demo and reviewer instructions | App owner credentials; enabled public distribution; real installation/removal evidence; active installation and usage eligibility confirmed by the submission console; reconcile the conflicting published thresholds (or qualifying Discovery API exception); Slack review and publication confirmation |
| Google Workspace / Gmail | API connectors, shared Google credential custody, publisher roles and review packets | Marketplace integration configuration for an eligible web app or add-on; listing graphics and reviewer instructions; scope reconciliation | Cloud project/Marketplace SDK access; consent configuration; domain ownership; sensitive/restricted OAuth verification as applicable; working reviewer account; Marketplace review and confirmation |
| Jira / Confluence | OAuth 3LO read connectors, publisher roles and review packets | 3LO app configuration/export, authorization/revoke walkthrough, informational listing assets and per-user installation evidence | Atlassian app owner/partner access; sharing enabled in developer console; integration approval and optional informational listing review; provider confirmation |

The shared publisher package is a local preparation helper. It does not schedule an agent, create an app in a provider account, submit a listing, or poll provider approval. Managed role templates must be provisioned by the managed-agent service before publisher agents can execute work.

`prepareHandoff` keeps `ready` as metadata completeness for compatibility. `submissionReady` additionally requires a nonempty evidence reference for every item in `checks`, supplied in `listingInput.checkEvidence` keyed by the exact check text. `missingChecks` lists incomplete evidence. Evidence completeness is not evidence verification or provider approval; the publishing agent must inspect the referenced artifacts. Neither flag means published.

Do not create placeholder Forge IDs, installation counts, verified domains or approval receipts to fill a packet. Complete eligible provider-native functionality and collect actual deployment and account evidence first.

Official sources checked:

- [Slack distribution and Marketplace submission](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/): in-Slack utility, distribution eligibility, active installation thresholds and review flow.
- [Google Marketplace SDK configuration](https://developers.google.com/workspace/marketplace/enable-configure-sdk): supported integration types, visibility and scope configuration.
- [Google Marketplace app review](https://developers.google.com/workspace/marketplace/about-app-review): OAuth verification, listing and reviewer requirements.
- [Atlassian Forge listings](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/): Forge app distribution and listing prerequisites.
- [Atlassian approval guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/): partner, security and listing requirements.

## Route corrections and remaining evidence

Atlassian explicitly supports informational Marketplace listings for OAuth 2.0 (3LO) integrations, with limited Marketplace features. The existing Jira and Confluence implementation can use this route; it does not need a fabricated Forge app ID. Sharing must be enabled, installation is per user, and enabling sharing alone does not create a listing. An integration can request approval without an informational listing. See [official 3LO distribution guidance](https://developer.atlassian.com/cloud/oauth/getting-started/managing-oauth-apps/).

Slack's [current guidelines](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/) mention 10 active workspaces and 10 weekly active users, while its [dated installation change](https://docs.slack.dev/changelog/2025/07/08/slack-marketplace/) says the workspace minimum changed to five on August 11, 2025. Record the actual submission-console requirement and activity evidence; do not mark eligibility complete from either number alone. In-Slack functionality remains required and is not implemented by the current external read connector.

Google supports a production web app with a universal navigation URL. A separate native add-on is therefore not mandatory for the web-app listing route. Configure that route only after the actual connector UI is fully functional in production, reconcile all scopes across the shared Google OAuth client and Marketplace SDK, and supply the required 48×48 and 96×96 icons. No production verification, Cloud project access or OAuth approval receipt is available in this audit. See [official SDK configuration](https://developers.google.com/workspace/marketplace/enable-configure-sdk).
