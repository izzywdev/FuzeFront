/** A publisher agent prepares a provider-specific review packet. It never submits it. */
export type SubmissionMode = 'console-review' | 'partner-contact' | 'no-public-route-confirmed';
export type PublisherDefinition = Readonly<{
  providerId: string;
  agentId: string;
  target: string;
  consoleUrl: string;
  documentationUrl: string;
  mode: SubmissionMode;
  qualifyingSurface: string;
  metadata: readonly string[];
  checks: readonly string[];
  review: string;
  handoff: string;
}>;

const commonMetadata = ['appName', 'shortDescription', 'longDescription', 'logoUrl', 'supportUrl', 'privacyPolicyUrl', 'termsUrl', 'contactEmail', 'screenshots'] as const;
const commonChecks = ['HTTPS redirect and landing URLs', 'live privacy and support links', 'scope to feature mapping', 'install, uninstall and account deletion test', 'reviewer test account and instructions', 'no secrets in evidence'] as const;
const google = (providerId: string, surface: string): PublisherDefinition => ({providerId, agentId: `${providerId}-marketplace-publisher`, target: 'Google Workspace Marketplace', consoleUrl: 'https://console.cloud.google.com/apis/library/appsmarket-component.googleapis.com', documentationUrl: 'https://developers.google.com/workspace/marketplace/how-to-publish', mode: 'console-review', qualifyingSurface: surface, metadata: [...commonMetadata, 'OAuth consent screen', 'host product configuration', 'listing language and categories'], checks: [...commonChecks, 'OAuth verification where required', 'Marketplace SDK configured', 'public listing review prerequisites'], review: 'Google reviews public listings; an OAuth client alone does not constitute a Marketplace app.', handoff: 'Workspace Marketplace listing draft and OAuth verification evidence'});
const microsoft = (providerId: string, surface: string, doc: string): PublisherDefinition => ({providerId, agentId: `${providerId}-marketplace-publisher`, target: 'Microsoft Marketplace', consoleUrl: 'https://partner.microsoft.com/dashboard/marketplace-offers/overview', documentationUrl: doc, mode: 'console-review', qualifyingSurface: surface, metadata: [...commonMetadata, 'publisher legal profile', 'app package or manifest', 'offer category', 'validation instructions'], checks: [...commonChecks, 'Partner Center enrollment', 'manifest validation', 'Microsoft certification policy review'], review: 'Partner Center certification and marketplace approval; a Graph OAuth connector by itself is not a store app.', handoff: 'Partner Center offer draft with validated package and certification notes'});

export const publisherDefinitions: readonly PublisherDefinition[] = [
  google('google-drive', 'Google Workspace Drive app or Workspace add-on with an actual Drive user interface'),
  google('google-calendar', 'Google Workspace add-on or supported web app integration with Calendar user interface'),
  google('google-contacts', 'Qualifying Google Workspace add-on or web app; People API OAuth access alone is insufficient'),
  microsoft('microsoft-outlook', 'Outlook add-in with Office add-in manifest', 'https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource'),
  microsoft('microsoft-onedrive', 'Qualifying Microsoft 365 app or SaaS marketplace offer; Graph file access alone is insufficient', 'https://learn.microsoft.com/en-us/partner-center/marketplace-offers/add-in-submission-guide'),
  {...microsoft('microsoft-teams', 'Teams app package with valid Teams manifest', 'https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish'), target: 'Microsoft Teams Store', checks: [...commonChecks, 'Teams app manifest validation', 'Teams Store validation guidelines']},
  {providerId: 'slack', agentId: 'slack-marketplace-publisher', target: 'Slack Marketplace', consoleUrl: 'https://api.slack.com/apps', documentationUrl: 'https://api.slack.com/start/distributing/directory', mode: 'console-review', qualifyingSurface: 'Distributable Slack app with OAuth installation and useful Slack functionality', metadata: [...commonMetadata, 'OAuth scopes', 'install URL', 'demo video or reviewer walkthrough'], checks: [...commonChecks, 'Slack Marketplace app guidelines', 'OAuth install in independent workspace', 'request only necessary scopes'], review: 'Submit from Slack app configuration; Slack reviews listing and app.', handoff: 'Slack app listing draft and install walkthrough'},
  {providerId: 'notion', agentId: 'notion-marketplace-publisher', target: 'Notion Marketplace Connections', consoleUrl: 'https://www.notion.so/profile/integrations', documentationUrl: 'https://developers.notion.com/guides/get-started/marketplace-listing', mode: 'console-review', qualifyingSurface: 'Public Notion connection using OAuth 2.0', metadata: [...commonMetadata, 'connection category', 'OAuth redirect URL'], checks: [...commonChecks, 'public connection OAuth flow', 'Notion listing guidance'], review: 'Create connection listing in Marketplace dashboard and submit for Notion review.', handoff: 'Notion connection listing draft and OAuth install evidence'},
  {providerId: 'github', agentId: 'github-marketplace-publisher', target: 'GitHub Marketplace', consoleUrl: 'https://github.com/settings/apps', documentationUrl: 'https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace', mode: 'console-review', qualifyingSurface: 'Public GitHub App; OAuth Apps alone are not GitHub Marketplace Apps', metadata: [...commonMetadata, 'GitHub App permissions', 'pricing plan', 'listing images'], checks: [...commonChecks, 'GitHub App public visibility', 'Marketplace listing requirements', 'verified publisher for paid plans'], review: 'Request publish from draft listing; GitHub onboarding expert reviews.', handoff: 'GitHub Marketplace listing draft and permission justification'},
  {providerId: 'dropbox', agentId: 'dropbox-marketplace-publisher', target: 'Dropbox App Center', consoleUrl: 'https://www.dropbox.com/developers/apps', documentationUrl: 'https://developers.dropbox.com/oauth-guide', mode: 'no-public-route-confirmed', qualifyingSurface: 'Dropbox production app; App Center inclusion requires a provider-confirmed route', metadata: [...commonMetadata, 'Dropbox app key', 'production status', 'permission scope justification'], checks: [...commonChecks, 'Dropbox production approval', 'OAuth scoped access', 'confirm App Center submission path with Dropbox'], review: 'No public self-service App Center listing submission route confirmed in official developer documentation.', handoff: 'Production app and App Center inquiry packet; obtain Dropbox confirmation before claiming listing'},
  google('google-gmail', 'Gmail add-on or Google Workspace app with a qualifying Gmail user interface'),
] as const;

export const getPublisher = (providerId: string): PublisherDefinition | undefined => publisherDefinitions.find(item => item.providerId === providerId);
export type ListingInput = Readonly<Record<string, unknown>>;
export type HandoffPacket = Readonly<{providerId: string; agentId: string; target: string; submissionMode: SubmissionMode; ready: boolean; missing: readonly string[]; checks: readonly string[]; evidence: Readonly<Record<string, unknown>>; handoff: string; documentationUrl: string}>;
/** Builds a local review artifact; caller must explicitly complete the provider's review flow. */
export function prepareHandoff(providerId: string, input: ListingInput): HandoffPacket {
  const publisher = getPublisher(providerId);
  if (!publisher) throw new Error(`Unknown publisher: ${providerId}`);
  const missing = publisher.metadata.filter(key => key === 'screenshots'
    ? !Array.isArray(input[key]) || !(input[key] as unknown[]).some(item => typeof item === 'string' && item.trim())
    : typeof input[key] !== 'string' || !(input[key] as string).trim());
  return {providerId, agentId: publisher.agentId, target: publisher.target, submissionMode: publisher.mode, ready: missing.length === 0 && publisher.mode !== 'no-public-route-confirmed', missing, checks: publisher.checks, evidence: input, handoff: publisher.handoff, documentationUrl: publisher.documentationUrl};
}
