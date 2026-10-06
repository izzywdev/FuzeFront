# Connector roadmap (57)

✅ means provider code and an OAuth or API-key read-action path exist. It does not imply merge, production configuration, live authorization, or app-store publication. Each provider gets a separately managed marketplace publisher role and a review packet; store publication requires its own provider approval.

| Wave | Providers | Status |
| --- | --- | --- |
| Existing | ✅ Google Gmail | Implemented in the existing chat path |
| 1 | ✅ Google Drive, ✅ Google Calendar, ✅ Google Contacts, ✅ Microsoft Outlook, ✅ Microsoft OneDrive, ✅ Microsoft Teams, ✅ Slack, ✅ Notion, ✅ GitHub, ✅ Dropbox | Implemented in PR #1203; release blocked |
| 2 | ✅ Google Sheets, ✅ Google Docs, ✅ Google Slides, ✅ Google Tasks, ✅ Microsoft SharePoint, ✅ Microsoft To Do, ✅ Jira Cloud, ✅ Confluence Cloud, ✅ Linear, ✅ Trello | Implemented in feature PR #1203 after PR #1204 merged into its branch; not on master |
| 3 | Box, Google Chat, Google Meet, Microsoft Planner, Microsoft Dynamics 365, Salesforce, HubSpot, Zendesk, Intercom, Freshdesk | Planned |
| 4 | Asana, Monday.com, ClickUp, Airtable, Figma, Miro, GitLab, Bitbucket, Azure DevOps, Jenkins | Planned |
| 5 | CircleCI, Sentry, Datadog, PagerDuty, Stripe, Shopify, QuickBooks, Xero, Zoom | Planned |
| 6 | ✅ OpenAI, ✅ Anthropic, ✅ Gemini, Base44, ✅ Vercel, ✅ Lovable, Replit | OpenAI, Anthropic, Gemini, Vercel and Lovable implemented in feature PR #1203; Base44 and Replit pending transport |

The existing Gmail path, waves 1 and 2, and five providers from wave 6 comprise 26 implemented connector integrations in code. The new feature code is still unmerged to master and unconfigured in production. Wave 2 builds on the shared OAuth, delegation, vault and publisher packages from wave 1; merge and deploy those prerequisites first. Wave 6 was added at user request. Its API-key services use delegated FuzeKeys credential onboarding; Replit requires MCP discovery and transport; Base44's read transport remains to be verified. The roadmap is a planning artifact, not a runtime registry.
