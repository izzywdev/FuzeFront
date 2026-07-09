import type { App, AppManifest, Icon } from '@fuzefront/app-registry-client'

/**
 * Presentation + routing helpers derived from the FROZEN app manifest. These
 * keep manifest semantics (menu-substitution, standalone routing, icon kinds)
 * in one place so the launcher, side menu, loader and router agree.
 */

/** Render an `Icon` (emoji glyph or image URL) consistently. */
export function iconGlyph(icon?: Icon): string | null {
  if (!icon) return null
  return icon.kind === 'emoji' ? icon.value : null
}

export function iconImageUrl(icon?: Icon): string | undefined {
  return icon && icon.kind === 'url' ? icon.value : undefined
}

/** Map a manifest integration type to the DS AppCard `integrationType`. */
export function integrationTypeOf(app: App): string {
  return app.manifest.integration.type
}

/** True when the active app yields the portal side menu for its own. */
export function isMenuSubstituted(manifest: AppManifest): boolean {
  // Substitution is a portal-mode chrome concern. Standalone apps render with
  // no portal chrome at all, so substitution is irrelevant there.
  return (
    manifest.mode === 'portal' && manifest.chrome?.menu === 'substitute'
  )
}

/** True when the topbar should be hidden while this app is active. */
export function isTopbarHidden(manifest: AppManifest): boolean {
  return manifest.mode === 'standalone' || manifest.chrome?.topbar === 'hidden'
}

/**
 * Where a standalone app is reachable. If the manifest declares a dedicated
 * `routing.host`, that wins (its own origin); otherwise it is path-based under
 * the main app host at `/standalone/:slug` (the host renders its surface there).
 */
export function standalonePath(app: App): string {
  // Path-based default: a dedicated in-shell standalone surface keyed by slug.
  // (manifest.routing.path is informational for the in-shell surface; the
  // surface itself is always routed under /standalone/:slug.)
  return `/standalone/${app.slug}`
}

/** External standalone host (own origin), if the manifest declares one. */
export function standaloneHost(app: App): string | undefined {
  return app.manifest.routing?.host
}

/** The portal route a portal-mode app is mounted at. */
export function portalPath(app: App): string {
  return `/app/${app.slug}`
}

/**
 * Navigate to wherever an app lives:
 *  - standalone + routing.host → its own origin (full navigation)
 *  - standalone (path-based)   → the in-shell standalone surface
 *  - portal                    → the shell's /app/:slug mount
 */
export function appHref(app: App): string {
  if (app.mode === 'standalone') {
    const host = standaloneHost(app)
    if (host) {
      const path = app.manifest.routing?.path ?? '/'
      return `https://${host}${path.startsWith('/') ? path : `/${path}`}`
    }
    return standalonePath(app)
  }
  return portalPath(app)
}
