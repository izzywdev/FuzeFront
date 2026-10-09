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
