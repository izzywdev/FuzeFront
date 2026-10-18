import type { App } from '@fuzefront/app-registry-client'
import { mobileDistributionLinks } from '../platform/appManifest'

/** Store/APK links on an application card. Only verified manifest links render. */
export function MobileDistributionLinks({ app }: { app: App }) {
  const links = mobileDistributionLinks(app.manifest.distribution)
  if (links.length === 0) return null

  return (
    <div
      aria-label={`${app.manifest.name} mobile downloads`}
      data-mobile-downloads={app.slug}
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        marginTop: 'var(--space-3)',
      }}
    >
      {links.map(link => (
        <a
          key={link.href}
          className="btn btn-ghost"
          href={link.href}
          rel="noopener noreferrer"
          onClick={event => event.stopPropagation()}
          style={{ fontSize: 'var(--text-sm)' }}
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}
