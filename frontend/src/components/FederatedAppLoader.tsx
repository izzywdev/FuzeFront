import React, { useState, useEffect, Suspense } from 'react'
import { useAppContext } from '@apphub/shared'
import { loadApp, clearModuleCache } from '../utils/loadFederatedApp'
import { FederatedAppErrorBoundary } from './FederatedAppErrorBoundary'

interface FederatedAppLoaderProps {
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
        border: '4px solid #333',
        borderTop: '4px solid #646cff',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        animation: 'spin 1s linear infinite',
      }}
    ></div>
    <p style={{ marginTop: '1rem', color: '#888' }}>Loading application...</p>
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
)

export function FederatedAppLoader({ appId }: FederatedAppLoaderProps) {
  const { state } = useAppContext()
  const [FederatedComponent, setFederatedComponent] =
    useState<React.ComponentType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const app = state.apps.find(a => a.id === appId)

  useEffect(() => {
    let mounted = true

    const loadFederatedApp = async () => {
      if (!app) {
        setError(`App with ID "${appId}" not found`)
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        if (app.integrationType === 'module-federation') {
          console.log(`Loading federated app: ${app.name}`)
          const module = await loadApp(appId)

          if (mounted) {
            setFederatedComponent(() => module.default)
          }
        } else if (app.integrationType === 'iframe') {
          // For iframe apps, we'll render an iframe component
          const IframeComponent = () => (
            <iframe
              src={app.url}
              style={{
                width: '100%',
                height: 'calc(100vh - 200px)',
                border: 'none',
                borderRadius: '8px',
              }}
              title={app.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )

          if (mounted) {
            setFederatedComponent(() => IframeComponent)
          }
        } else if (app.integrationType === 'web-component') {
          // For web components, we'll create a wrapper
          const WebComponentWrapper = () => {
            const [webComponentLoaded, setWebComponentLoaded] = useState(false)
            const [webComponentError, setWebComponentError] = useState<
              string | null
            >(null)

            useEffect(() => {
              const loadWebComponent = async () => {
                try {
                  console.log(`Loading web component: ${app.name}`)

                  // Extract component name from URL or use app name as fallback
                  const componentName =
                    app.scope ||
                    `app-${app.name.toLowerCase().replace(/\s+/g, '-')}`

                  // Check if component is already registered
                  if (customElements.get(componentName)) {
                    setWebComponentLoaded(true)
                    return
                  }

                  // Load the web component script if remoteUrl is provided
                  if (app.remoteUrl) {
                    await new Promise<void>((resolve, reject) => {
                      const script = document.createElement('script')
                      script.src = app.remoteUrl!
                      script.type = 'text/javascript'
                      script.async = true
                      script.onload = () => resolve()
                      script.onerror = () =>
                        reject(
                          new Error(
                            `Failed to load web component script: ${app.remoteUrl}`
                          )
                        )
                      document.head.appendChild(script)
                    })

                    // Wait a bit for the component to register
                    await new Promise(resolve => setTimeout(resolve, 100))
                  }

                  // Check if component is now available
                  if (customElements.get(componentName)) {
                    setWebComponentLoaded(true)
                  } else {
                    throw new Error(
                      `Web component "${componentName}" not found after loading script`
                    )
                  }
                } catch (error) {
                  console.error('Error loading web component:', error)
                  setWebComponentError(
                    error instanceof Error ? error.message : 'Unknown error'
                  )
                }
              }

              loadWebComponent()
            }, [])

            if (webComponentError) {
              return (
                <div
                  style={{
                    padding: '2rem',
                    textAlign: 'center',
                    color: '#ff6b6b',
                    border: '1px dashed #ff6b6b',
                    borderRadius: '8px',
                  }}
                >
                  <h3>⚠️ Web Component Error</h3>
                  <p>{webComponentError}</p>
                  <p style={{ fontSize: '0.8rem', marginTop: '1rem' }}>
                    App: {app.name}
                  </p>
                  <p style={{ fontSize: '0.8rem' }}>URL: {app.url}</p>
                </div>
              )
            }

            if (!webComponentLoaded) {
              return (
                <div
                  style={{
                    padding: '2rem',
                    textAlign: 'center',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <LoadingSpinner />
                  <p>Loading web component: {app.name}</p>
                </div>
              )
            }

            const componentName =
              app.scope || `app-${app.name.toLowerCase().replace(/\s+/g, '-')}`

            return (
              <div
                style={{
                  width: '100%',
                  height: 'calc(100vh - 200px)',
                  overflow: 'auto',
                }}
              >
                {/* Create the web component dynamically */}
                <div
                  ref={el => {
                    if (el && !el.hasChildNodes()) {
                      const webComponent = document.createElement(componentName)
                      // Pass context data as attributes if needed
                      webComponent.setAttribute('data-app-id', app.id)
                      webComponent.setAttribute('data-app-name', app.name)
                      el.appendChild(webComponent)
                    }
                  }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            )
          }

          if (mounted) {
            setFederatedComponent(() => WebComponentWrapper)
          }
        } else {
          throw new Error(
            `Unsupported integration type: ${app.integrationType}`
          )
        }
      } catch (err) {
        console.error(`Failed to load app "${app?.name}":`, err)
        if (mounted) {
          setError(
            err instanceof Error ? err.message : 'Unknown error occurred'
          )
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadFederatedApp()

    return () => {
      mounted = false
    }
  }, [appId, app, retryKey])

  const handleRetry = () => {
    // Clear module cache and retry
    clearModuleCache()
    setRetryKey(prev => prev + 1)
  }

  if (loading) {
    return <LoadingSpinner />
  }

  if (error) {
    return (
      <div
        style={{
          padding: '2rem',
          border: '1px solid #ff6b6b',
          borderRadius: '8px',
          backgroundColor: '#2a1f1f',
          textAlign: 'center',
          color: '#ff6b6b',
        }}
      >
        <h3>⚠️ Failed to Load App</h3>
        <p>{error}</p>
        <button
          className="btn btn-primary"
          onClick={handleRetry}
          style={{ marginTop: '1rem' }}
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
          padding: '2rem',
          textAlign: 'center',
          color: '#888',
        }}
      >
        <p>No component loaded</p>
      </div>
    )
  }

  return (
    <FederatedAppErrorBoundary appName={app?.name} onRetry={handleRetry}>
      <Suspense fallback={<LoadingSpinner />}>
        <FederatedComponent />
      </Suspense>
    </FederatedAppErrorBoundary>
  )
}
