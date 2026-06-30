import { useLocation } from 'react-router-dom'
import type { App } from '@fuzefront/app-registry-client'
import { useAppRegistry } from './appRegistry'

/**
 * Resolve the currently-active registered app from the route.
 *
 * Portal apps mount at `/app/:slug`; standalone apps (path-based) at
 * `/standalone/:slug`. Returns the manifest `App` (or null when the route is a
 * normal portal page), so the side menu / chrome can decide whether to yield
 * the portal menu (menu-substitution) or hide chrome (standalone).
 */
export function useActiveApp(): App | null {
  const location = useLocation()
  const { getBySlug } = useAppRegistry()

  const match =
    /^\/app\/([^/]+)/.exec(location.pathname) ??
    /^\/standalone\/([^/]+)/.exec(location.pathname)
  if (!match) return null

  const slug = decodeURIComponent(match[1])
  return getBySlug(slug) ?? null
}
