/**
 * Connector visual assets are deliberately centralized here so the catalog and
 * detail views render the same provider identity. Marks are bundled from the
 * Simple Icons asset package; unknown future providers use an initials tile.
 */
import * as icons from 'simple-icons'

const brand: Record<string, keyof typeof icons> = {
  'google-gmail': 'siGmail', 'google-drive': 'siGoogledrive', 'google-calendar': 'siGooglecalendar',
  'google-sheets': 'siGooglesheets', 'google-docs': 'siGoogledocs', 'google-slides': 'siGoogleslides',
  'google-tasks': 'siGoogletasks', notion: 'siNotion', replit: 'siReplit', linear: 'siLinear',
  trello: 'siTrello', github: 'siGithub', dropbox: 'siDropbox', vercel: 'siVercel',
  anthropic: 'siAnthropic', gemini: 'siGooglegemini', 'jira-cloud': 'siJira', 'confluence-cloud': 'siConfluence',
}

export function connectorIconSource(id: string): string | null {
  const icon = brand[id] ? icons[brand[id]] as { path?: string; hex?: string } : undefined
  if (!icon?.path) return null
  const fill = icon.hex ? `#${icon.hex}` : 'currentColor'
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${icon.path}"/></svg>`)}`
}

export function connectorInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

export type ConnectorProviderLink = { href: string; label: string; marketplace?: boolean }

// No verified FuzeOne marketplace listing is currently recorded in this
// catalog. Keep the fallback explicit: a future verified listing can replace
// `href` and set `marketplace` without changing the details page.
const providerLinks: Record<string, ConnectorProviderLink> = {
  'google-gmail': { href: 'https://workspace.google.com/', label: 'Visit Google Workspace' },
  'google-drive': { href: 'https://workspace.google.com/products/drive/', label: 'Visit Google Drive' },
  'google-calendar': { href: 'https://workspace.google.com/products/calendar/', label: 'Visit Google Calendar' },
  'google-contacts': { href: 'https://workspace.google.com/products/contacts/', label: 'Visit Google Contacts' },
  'google-sheets': { href: 'https://workspace.google.com/products/sheets/', label: 'Visit Google Sheets' },
  'google-docs': { href: 'https://workspace.google.com/products/docs/', label: 'Visit Google Docs' },
  'google-slides': { href: 'https://workspace.google.com/products/slides/', label: 'Visit Google Slides' },
  'google-tasks': { href: 'https://workspace.google.com/products/tasks/', label: 'Visit Google Tasks' },
  slack: { href: 'https://slack.com/', label: 'Visit Slack' },
  notion: { href: 'https://www.notion.so/', label: 'Visit Notion' },
  replit: { href: 'https://replit.com/', label: 'Visit Replit' },
  linear: { href: 'https://linear.app/', label: 'Visit Linear' },
  trello: { href: 'https://trello.com/', label: 'Visit Trello' },
  github: { href: 'https://github.com/', label: 'Visit GitHub' },
  dropbox: { href: 'https://www.dropbox.com/', label: 'Visit Dropbox' },
  vercel: { href: 'https://vercel.com/', label: 'Visit Vercel' },
  lovable: { href: 'https://lovable.dev/', label: 'Visit Lovable' },
  openai: { href: 'https://openai.com/', label: 'Visit OpenAI' },
  anthropic: { href: 'https://www.anthropic.com/', label: 'Visit Anthropic' },
  gemini: { href: 'https://ai.google.dev/', label: 'Visit Google AI' },
  'microsoft-outlook': { href: 'https://www.microsoft.com/microsoft-365/outlook/', label: 'Visit Microsoft Outlook' },
  'microsoft-onedrive': { href: 'https://www.microsoft.com/microsoft-365/onedrive/', label: 'Visit Microsoft OneDrive' },
  'microsoft-teams': { href: 'https://www.microsoft.com/microsoft-teams/', label: 'Visit Microsoft Teams' },
  'microsoft-sharepoint': { href: 'https://www.microsoft.com/microsoft-365/sharepoint/', label: 'Visit Microsoft SharePoint' },
  'microsoft-todo': { href: 'https://www.microsoft.com/microsoft-365/microsoft-to-do-list-app/', label: 'Visit Microsoft To Do' },
  'jira-cloud': { href: 'https://www.atlassian.com/software/jira/', label: 'Visit Jira' },
  'confluence-cloud': { href: 'https://www.atlassian.com/software/confluence/', label: 'Visit Confluence' },
  base44: { href: 'https://base44.com/', label: 'Visit Base44' },
}

export function connectorProviderLink(id: string): ConnectorProviderLink | null {
  return providerLinks[id] || null
}
