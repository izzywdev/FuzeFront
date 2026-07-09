import React, { useState, useEffect, Suspense } from 'react'
import type { App } from '@fuzefront/app-registry-client'
import { useCurrentUser } from '../lib/shared'
import { useAppRegistry } from '../platform/appRegistry'
import {
  loadFederatedAppFromManifest,
  clearModuleCache,
} from '../utils/loadFederatedApp'
import { FederatedAppErrorBoundary } from './FederatedAppErrorBoundary'

interface FederatedAppLoaderProps {
  /** App slug (the manifest's immutable id, used in /app/:slug). */
  appId: string
}

const LoadingSpinner = () => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '200px',
      flexDirection: 'column',
    }}
  >
    <div
      style={{
        border: '4px solid var(--border-color)',
        borderTop: '4px solid var(--accent-color)',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        animation: 'spin 1s linear infinite',
      }}
    ></div>
    <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-tertiary)' }}>
      Loading application...
    </p>
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
)

/**
 * Mounts a portal-mode app described by the FROZEN app-registry manifest.
 * Supports every manifest `integration.type`:
 *   - module-federation → runtime MF remote (full remoteEntry URL)
 *   - iframe / spa      → navigable URL embedded in an iframe surface
 *   - web-component     → custom element loaded from a script URL
 */
export function FederatedAppLoader({ appId }: FederatedAppLoaderProps) {
  const { apps, loading: appsLoading, getBySlug } = useAppRegistry()
  const { user } = useCurrentUser()
  const [FederatedComponent, setFederatedComponent] =
    useState<React.ComponentType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const app: App | undefined = getBySlug(appId)

  // Set up the platform context that runtime-loaded apps read off `window`.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__FRONTFUSE_PLATFORM__ = true;
      (window as any).__FRONTFUSE_CONTEXT__ = {
        user,
        session: user
          ? {
              id: 'current-session',
              userId: user.id,
              tenantId: 'default-tenant',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            }
          : null,
        apps,
        activeApp: app,
        isPlatformMode: true,
      }
    }
  }, [user, app, apps])

  useEffect(() => {
    let mounted = true

    const load = async () => {
      if (!app) {
        // Deep-link / refresh: the registry list may not have arrived yet.
        // Stay on the spinner until it loads, then error only if truly absent.
        if (appsLoading || apps.length === 0) {
          setLoading(true)
          return
        }
        setError(`App "${appId}" not found or not activated`)
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        const { integration, name } = app.manifest

        if (integration.type === 'module-federation') {
          const module = await loadFederatedAppFromManifest(app)
          if (mounted) setFederatedComponent(() => module.default)
        } else if (integration.type === 'iframe' || integration.type === 'spa') {
          // `spa` previously had NO loader branch — fill that gap. A standalone
          // single-page app is embedded by its navigable URL, same as an iframe
          // app, when mounted inside the portal.
          const url = integration.url
          if (!url) {
            throw new Error(`App '${name}' (${integration.type}) is missing integration.url`)
          }
          const FrameComponent = () => (
            <iframe
              src={url}
              style={{
                width: '100%',
                height: 'calc(100vh - var(--top-bar-height) - var(--space-8))',
                border: 'none',
                borderRadius: 'var(--radius-md)',
              }}
              title={name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )
          if (mounted) setFederatedComponent(() => FrameComponent)
        } else if (integration.type === 'web-component') {
          const WebComponentWrapper = () => {
            const ref = (el: HTMLDivElement | null) => {
              if (!el || el.hasChildNodes()) return
              const tag =
                integration.scope ||
                `app-${name.toLowerCase().replace(/\s+/g, '-')}`
              const mount = () => {
                const node = document.createElement(tag)
                node.setAttribute('data-app-slug', app.slug)
                node.setAttribute('data-app-name', name)
                el.appendChild(node)
              }
              if (customElements.get(tag)) {
                mount()
              } else if (integration.url) {
                const script = document.createElement('script')
                script.src = integration.url
                script.async = true
                script.onload = () =>
                  customElements.whenDefined(tag).then(mount)
                document.head.appendChild(script)
              }
            }
            return (
              <div
                ref={ref}
                style={{
                  width: '100%',
                  height: 'calc(100vh - var(--top-bar-height) - var(--space-8))',
                  overflow: 'auto',
                }}
              />
            )
          }
          if (mounted) setFederatedComponent(() => WebComponentWrapper)
        } else {
          throw new Error(`Unsupported integration type: ${integration.type}`)
        }
      } catch (err) {
        console.error(`Failed to load app "${app?.manifest.name}":`, err)
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Unknown error occurred')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [appId, app, retryKey, appsLoading, apps.length])

  const handleRetry = () => {
    clearModuleCache()
    setRetryKey(prev => prev + 1)
  }

  if (loading) return <LoadingSpinner />

  if (error) {
    return (
      <div
        style={{
          padding: 'var(--space-8)',
          border: '1px solid var(--error-color)',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-tertiary)',
          textAlign: 'center',
          color: 'var(--error-color)',
        }}
      >
        <h3>⚠️ Failed to Load App</h3>
        <p>{error}</p>
        <button
          className="btn btn-primary"
          onClick={handleRetry}
          style={{ marginTop: 'var(--space-4)' }}
        >
          🔄 Retry
        </button>
      </div>
    )
  }

  if (!FederatedComponent) {
    return (
      <div
        style={{
          padding: 'var(--space-8)',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        <p>No component loaded</p>
      </div>
    )
  }

  return (
    <FederatedAppErrorBoundary appName={app?.manifest.name} onRetry={handleRetry}>
      <Suspense fallback={<LoadingSpinner />}>
        <FederatedComponent />
      </Suspense>
    </FederatedAppErrorBoundary>
  )
}
