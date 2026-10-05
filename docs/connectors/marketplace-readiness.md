# Marketplace readiness — audited 2026-10-05

These are source-code findings, not observations of provider accounts or production installations. No listing is confirmed published.

| Provider | Implemented | Missing code/assets | External evidence or access required |
| --- | --- | --- | --- |
| Slack | OAuth connector, read actions, publisher role and review packet | In-Slack user-facing functionality; distributable Slack app configuration; listing graphics, demo and reviewer instructions | App owner credentials; enabled public distribution; real installation/removal evidence; at least 10 active non-sandbox workspaces and 10 weekly active users (or qualifying Discovery API exception); Slack review and publication confirmation |
| Google Workspace / Gmail | API connectors, shared Google credential custody, publisher roles and review packets | Marketplace integration configuration for an eligible web app or add-on; listing graphics and reviewer instructions; scope reconciliation | Cloud project/Marketplace SDK access; consent configuration; domain ownership; sensitive/restricted OAuth verification as applicable; working reviewer account; Marketplace review and confirmation |
| Jira / Confluence | OAuth 3LO read connectors, publisher roles and review packets | Qualifying Forge application, registered Forge app ID, deployed user-facing module and installation evidence; listing assets | Atlassian partner account; Forge registration/deployment access; security/privacy and remote responsibility evidence if remote services are used; Marketplace review and confirmation |

The shared publisher package is a local preparation helper. It does not schedule an agent, create an app in a provider account, submit a listing, or poll provider approval. Managed role templates must be provisioned by the managed-agent service before publisher agents can execute work.

`prepareHandoff` keeps `ready` as metadata completeness for compatibility. `submissionReady` additionally requires a nonempty evidence reference for every item in `checks`, supplied in `listingInput.checkEvidence` keyed by the exact check text. `missingChecks` lists incomplete evidence. Evidence completeness is not evidence verification or provider approval; the publishing agent must inspect the referenced artifacts. Neither flag means published.

Do not create placeholder Forge IDs, installation counts, verified domains or approval receipts to fill a packet. Complete eligible provider-native functionality and collect actual deployment and account evidence first.

Official sources checked:

- [Slack distribution and Marketplace submission](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/): in-Slack utility, distribution eligibility, active installation thresholds and review flow.
- [Google Marketplace SDK configuration](https://developers.google.com/workspace/marketplace/enable-configure-sdk): supported integration types, visibility and scope configuration.
- [Google Marketplace app review](https://developers.google.com/workspace/marketplace/about-app-review): OAuth verification, listing and reviewer requirements.
- [Atlassian Forge listings](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/): Forge app distribution and listing prerequisites.
- [Atlassian approval guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/): partner, security and listing requirements.
