# Connector marketplace publisher agents

Each provider also has a managed sub-agent role in `agent-templates/roles/<provider>-marketplace-publisher/role.json`. Provision these roles through the managed-agents sync before assigning publication work.

Each provider has a separate `*-marketplace-publisher` definition in `packages/connector-publisher`. The shared `prepareHandoff(providerId, listingInput)` function checks required listing fields and produces a review packet. It never calls a provider publication API, opens a console session, or reports a listing as published. `ready` means the supplied metadata is present, not that the feature, security review, or submission is complete. Complete every item in `checks`, attach evidence, and obtain a human review before submission.

A connector's OAuth integration does not automatically qualify as a store app. Build the required provider-native app surface before using the relevant submission path. The publisher agent for each provider owns the listing draft, reviewer test instructions, screenshots, install and uninstall evidence, scope rationale, policy checks, and handoff packet. Publication status should only be set from actual provider confirmation.

| Provider | Store and required surface | Submission route |
| --- | --- | --- |
| google-drive | Google Workspace Marketplace; qualifying Drive app or add-on | Google Cloud Marketplace SDK listing and public review |
| google-calendar | Google Workspace Marketplace; qualifying Calendar add-on or web app | Google Cloud Marketplace SDK listing and public review |
| google-contacts | Google Workspace Marketplace; qualifying Workspace add-on or web app | Google Cloud Marketplace SDK listing and public review |
| microsoft-outlook | Microsoft Marketplace; Outlook add-in manifest | Partner Center offer and certification |
| microsoft-onedrive | Microsoft Marketplace; qualifying Microsoft 365 app or SaaS offer | Partner Center offer and certification |
| microsoft-teams | Teams Store; Teams app package | Partner Center submission and Teams validation |
| slack | Slack Marketplace; distributable Slack app | Submit from Slack app configuration for review |
| notion | Notion Marketplace Connections; public OAuth connection | Marketplace listing dashboard review |
| github | GitHub Marketplace; public GitHub App | Draft listing, Request publish, onboarding review |
| dropbox | Dropbox App Center; Dropbox production app | Public self-service submission route not confirmed; ask Dropbox for its listing process |
| gmail | Google Workspace Marketplace; qualifying Gmail add-on or app | Google Cloud Marketplace SDK listing and public review |

Google's [publishing](https://developers.google.com/workspace/marketplace/how-to-publish) and [review](https://developers.google.com/workspace/marketplace/about-app-review) guidance; Microsoft's [Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource), [Partner Center](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/add-in-submission-guide), and [Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish) guidance; [Slack submission](https://api.slack.com/start/distributing/directory); [Notion listing](https://developers.notion.com/guides/get-started/marketplace-listing); [GitHub listing](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace) and [requirements](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app); [Dropbox OAuth](https://developers.dropbox.com/oauth-guide) and [developer console](https://www.dropbox.com/developers) are the provider references for these definitions. The Dropbox route is deliberately marked unresolved because official public documentation reviewed here does not establish a self-service App Center submission process.

Example:

```ts
import { prepareHandoff } from '@fuzefront/connector-publisher';
const packet = prepareHandoff('slack', listingMetadata);
// Store packet for reviewer sign-off; never interpret packet.ready as store approval.
```
