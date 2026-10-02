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
| google-sheets | Google Workspace Marketplace; Sheets Editor add-on, Workspace add-on or integrated web app | Marketplace SDK listing and public review |
| google-docs | Google Workspace Marketplace; Docs Editor add-on, Workspace add-on or integrated web app | Marketplace SDK listing and public review |
| google-slides | Google Workspace Marketplace; Slides Editor add-on, Workspace add-on or integrated web app | Marketplace SDK listing and public review |
| google-tasks | Google Workspace Marketplace; qualifying Workspace add-on or integrated web app | Marketplace SDK listing and public review; no standalone Tasks add-on assumed |
| microsoft-sharepoint | Microsoft Marketplace; modern SharePoint Framework solution or qualifying Microsoft 365 app | Partner Center offer and certification; retired SharePoint Add-ins cannot be newly submitted |
| microsoft-todo | Microsoft Marketplace; qualifying Microsoft 365 app or SaaS offer | Partner Center offer and certification |
| jira-cloud | Atlassian Marketplace; qualifying Jira Cloud Forge app | Atlassian Marketplace listing and review; new Connect publication is closed |
| confluence-cloud | Atlassian Marketplace; qualifying Confluence Cloud Forge app | Atlassian Marketplace listing and review; new Connect publication is closed |
| linear | Linear Integrations Directory; public OAuth integration | Linear integration directory submission and review |
| trello | Trello Power-Up Directory; qualifying Power-Up | Trello developer support submission and review |

Google’s [publishing](https://developers.google.com/workspace/marketplace/how-to-publish) and [review](https://developers.google.com/workspace/marketplace/about-app-review) guidance; Microsoft's [Office add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource), [Partner Center](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/add-in-submission-guide), and [Teams](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish) guidance; [Slack submission](https://api.slack.com/start/distributing/directory); [Notion listing](https://developers.notion.com/guides/get-started/marketplace-listing); [GitHub listing](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace) and [requirements](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app); [Dropbox OAuth](https://developers.dropbox.com/oauth-guide) and [developer console](https://www.dropbox.com/developers) are the provider references for these definitions. The Dropbox route is deliberately marked unresolved because official public documentation reviewed here does not establish a self-service App Center submission process.

Wave 2 references: Google's [Marketplace SDK app types](https://developers.google.com/workspace/marketplace/enable-configure-sdk); Microsoft's [modern SharePoint publishing](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/publish-to-marketplace-overview), [publisher checklist](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/checklist), and [SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer); Atlassian's [listing guide](https://developer.atlassian.com/platform/marketplace/creating-a-marketplace-listing/) and [selling guide](https://developer.atlassian.com/platform/marketplace/selling-on-marketplace/); Linear's [directory guide](https://linear.app/developers/integration-directory); and Trello's [Power-Up submission guide](https://developer.atlassian.com/cloud/trello/guides/power-ups/submitting-your-power-up/).

Example:

```ts
import { prepareHandoff } from '@fuzefront/connector-publisher';
const packet = prepareHandoff('slack', listingMetadata);
// Store packet for reviewer sign-off; never interpret packet.ready as store approval.
```
