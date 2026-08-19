import { ExternalLink } from '@fuzefront/design-system'

/**
 * The "Open portal ↗" launch action. A plain, real
 * `<a target="_blank" rel="noopener noreferrer" href={launchUrl}>` to the
 * portal's OWN host — never an in-app route, never `window.open`, never a
 * same-tab navigation that would unmount the shell. `launchUrl` is
 * server-authoritative (the portal's primary custom domain, or the root
 * host's `/p/{slug}` path route when it has none) — this component never
 * composes a host from client-held data, it only renders what the server
 * returned. Composes the DS ExternalLink, which owns the target/rel
 * contract (cannot be overridden by props).
 */
export function OpenPortalLink({
  portalId,
  launchUrl,
}: {
  portalId: string
  launchUrl: string
}) {
  return (
    <ExternalLink
      href={launchUrl}
      variant="button"
      data-action="open-portal"
      data-portal-target={portalId}
    >
      Open portal
    </ExternalLink>
  )
}
