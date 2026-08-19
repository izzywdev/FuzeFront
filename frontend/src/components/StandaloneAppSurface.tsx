import { useEffect, useState, Suspense } from 'react'
import type React from 'react'
import type { App } from '@fuzefront/app-registry-client'
import { useAppRegistry } from '../platform/appRegistry'
import { loadFederatedAppFromManifest } from '../utils/loadFederatedApp'
import { FederatedAppErrorBoundary } from './FederatedAppErrorBoundary'

/**
 * Standalone surface (frame 04-standalone): renders a `mode = "standalone"` app
 * WITHOUT any portal chrome — no side menu, no topbar — edge to edge. This is
 * the in-shell, path-based standalone surface (`/standalone/:slug`); apps that
 * declare a dedicated `routing.host` are navigated to their own origin instead
 * (handled by the launcher/menu, never reaching here).
 */
function StandaloneAppSurface({ slug }: { slug: string }) {
  const { getBySlug, apps, loading: appsLoading } = useAppRegistry()
  const [Component, setComponent] = useState<React.ComponentType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const app: App | undefined = getBySlug(slug)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!app) {
        if (appsLoading || apps.length === 0) {
          setLoading(true)
          return
        }
        setError(`Standalone app "${slug}" not found or not activated`)
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        setError(null)
        const { integration, name } = app.manifest
        if (integration.type === 'module-federation') {
          const mod = await loadFederatedAppFromManifest(app)
          if (mounted) setComponent(() => mod.default)
        } else if (
          integration.type === 'iframe' ||
          integration.type === 'spa'
        ) {
          const url = integration.url
          if (!url) throw new Error(`App '${name}' is missing integration.url`)
          const Frame = () => (
            <iframe
              src={url}
              title={name}
              style={{ width: '100vw', height: '100vh', border: 'none' }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )
          if (mounted) setComponent(() => Frame)
        } else {
          throw new Error(`Unsupported integration type: ${integration.type}`)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load app')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [app, slug, appsLoading, apps.length])

  // Edge-to-edge standalone canvas, no portal chrome (matches frame 04).
  const canvas: React.CSSProperties = {
    minHeight: '100vh',
    width: '100vw',
    background:
      'radial-gradient(1200px 480px at 70% -10%, rgba(110,92,255,0.18), transparent 60%),' +
      'radial-gradient(900px 420px at 10% 110%, rgba(41,211,230,0.14), transparent 60%),' +
      'var(--bg-primary)',
    color: 'var(--text-primary)',
  }

  if (loading) {
    return (
      <div style={{ ...canvas, display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--text-tertiary)' }}>Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...canvas, display: 'grid', placeItems: 'center' }}>
        <div style={{ color: 'var(--error-color)', textAlign: 'center' }}>
          <h3>⚠️ Failed to load standalone app</h3>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={canvas}>
      <FederatedAppErrorBoundary appName={app?.manifest.name}>
        <Suspense fallback={null}>{Component ? <Component /> : null}</Suspense>
      </FederatedAppErrorBoundary>
    </div>
  )
}

export default StandaloneAppSurface
