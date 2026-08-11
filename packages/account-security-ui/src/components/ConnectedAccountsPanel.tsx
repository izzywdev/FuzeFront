import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Skeleton, StatusCallout } from '@fuzefront/design-system'
import {
  AccountSecurityI18nProvider,
  useAccountSecurityI18n,
  type AccountSecurityLocale,
} from '../i18n/AccountSecurityI18nProvider'
import { SignInMethodsList } from './SignInMethodsList'
import { ConnectProviderButton } from './ConnectProviderButton'
import { LoadErrorRetry } from './LoadErrorRetry'
import { createAccountSecurityClient } from '../api/securityClient'
import { HttpError } from '../api/http'
import { providerDisplayName } from './providers'
import type { AccountSecurityClient, IdentityConnections, SocialProvider } from '../types'

/** The social-provider catalogue this panel offers to connect. Extensible. */
const ALL_PROVIDERS: SocialProvider[] = ['google']

export interface ConnectedAccountsPanelProps {
  /** Injected client (tests/host). Defaults to a same-origin client. */
  client?: AccountSecurityClient
  /** Bearer-token accessor for the default client. */
  getToken?: () => string | null | undefined
  locale?: AccountSecurityLocale
  /** Host navigation (e.g. the "Security" breadcrumb, "view connected accounts"). */
  onNavigate?: (route: string) => void
  /** App-relative route the "Security" breadcrumb returns to. Default `/account/security`. */
  hubRoute?: string
  /** Navigate to the set-password surface (offered by both fail-closed guards). */
  onSetPassword?: () => void
  /**
   * The provider named in a `?linked=<provider>` return from the social-link
   * handshake (the host reads this from the route's query string). Renders the
   * `linked` success state; the connections list is refreshed on mount as
   * usual so the newly linked provider's row appears from real data.
   */
  linkedProvider?: SocialProvider | null
  /**
   * The provider named in a `?error=<provider>` return from a cancelled/failed
   * handshake (see `packages/security/openapi.yaml` social callback). Seeds
   * the `link-failed` state on mount.
   */
  errorProvider?: SocialProvider | null
  /** Navigate the browser to an external URL. Defaults to `window.location.assign`. Injectable for tests. */
  navigateExternal?: (url: string) => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; connections: IdentityConnections }

type ConnectState =
  | { status: 'idle' }
  | { status: 'redirecting'; provider: SocialProvider }
  | { status: 'link-failed'; provider: SocialProvider }
  | { status: 'already-linked'; provider: SocialProvider }

/**
 * Flow orchestrator for `/account/security/connections` (approved frames
 * 01–03, FFRNT-296). Loads the account's sign-in connections, renders the
 * "ways you sign in" list + "add a way to sign in" affordances, and drives the
 * whole connect handshake in-page: the redirect-intent confirmation, the
 * external navigation to the provider, and the return states (`linked`,
 * `link-failed`, `already-linked`). Fail-closed throughout: a load error never
 * shows a partial/permissive panel, and unlinking the account's only method is
 * guarded both proactively (disabled control) and reactively (409 catch).
 */
export function ConnectedAccountsPanel(props: ConnectedAccountsPanelProps) {
  const locale = props.locale ?? 'en'
  return (
    <AccountSecurityI18nProvider locale={locale}>
      <ConnectedAccountsPanelInner {...props} />
    </AccountSecurityI18nProvider>
  )
}

function ConnectedAccountsPanelInner({
  client,
  getToken,
  onNavigate,
  hubRoute = '/account/security',
  onSetPassword,
  linkedProvider,
  errorProvider,
  navigateExternal,
}: ConnectedAccountsPanelProps) {
  const { messages: m, t, dir } = useAccountSecurityI18n()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [connectState, setConnectState] = useState<ConnectState>(
    errorProvider ? { status: 'link-failed', provider: errorProvider } : { status: 'idle' }
  )

  const api = useMemo(() => client ?? createAccountSecurityClient({ getToken }), [client, getToken])
  const navigate = useMemo(
    () => navigateExternal ?? ((url: string) => window.location.assign(url)),
    [navigateExternal]
  )

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const connections = await api.getConnections()
      setState({ status: 'ready', connections })
    } catch {
      setState({ status: 'error' })
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const handleUnlink = useCallback(
    (provider: SocialProvider) => api.unlinkProvider(provider),
    [api]
  )

  const handleConnectIntent = useCallback((provider: SocialProvider) => {
    setConnectState({ status: 'redirecting', provider })
  }, [])

  const handleConfirmConnect = useCallback(
    async (provider: SocialProvider) => {
      if (!api.linkProvider) return
      try {
        const { redirectUrl } = await api.linkProvider(provider)
        navigate(redirectUrl)
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          setConnectState({ status: 'already-linked', provider })
        } else {
          setConnectState({ status: 'link-failed', provider })
        }
      }
    },
    [api, navigate]
  )

  const handleCancelConnect = useCallback(() => setConnectState({ status: 'idle' }), [])

  const unlinkedProviders = useMemo(() => {
    if (state.status !== 'ready') return []
    const linked = new Set(state.connections.providers.map((c) => c.provider))
    return ALL_PROVIDERS.filter((p) => !linked.has(p))
  }, [state])

  return (
    <main dir={dir} data-frame="connected-accounts" data-panel="connected-accounts">
      {onNavigate && (
        <button
          type="button"
          data-route={hubRoute}
          onClick={() => onNavigate(hubRoute)}
          style={{
            all: 'unset',
            cursor: 'pointer',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-3)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <span aria-hidden="true" style={{ display: 'inline-block', transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }}>
            ←
          </span>
          {m.page.title}
        </button>
      )}

      <h1
        style={{
          margin: '0 0 var(--space-1)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
          color: 'var(--text-primary)',
        }}
      >
        {m.connections.page.title}
      </h1>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>
        {m.connections.page.subtitle}
      </p>

      {linkedProvider && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <StatusCallout
            tone="info"
            icon="✓"
            title={t(m.connect.linkedTitle, { provider: providerDisplayName(linkedProvider) })}
            data-state="linked"
            data-linked={linkedProvider}
            actions={
              onNavigate && (
                <Button variant="ghost" size="sm" onClick={() => onNavigate(hubRoute)}>
                  {m.connect.viewConnected}
                </Button>
              )
            }
          >
            {t(m.connect.linkedText, { provider: providerDisplayName(linkedProvider) })}
          </StatusCallout>
        </div>
      )}

      {state.status === 'loading' && (
        <div data-state="loading" role="status" aria-busy="true" aria-label={m.loading.label}>
          <Skeleton width="40%" height="var(--space-5)" />
          <div style={{ height: 'var(--space-3)' }} />
          <Skeleton height="var(--space-10)" radius="var(--radius-md)" />
          <div style={{ height: 'var(--space-2)' }} />
          <Skeleton height="var(--space-10)" radius="var(--radius-md)" />
        </div>
      )}

      {state.status === 'error' && <LoadErrorRetry onRetry={() => void load()} />}

      {state.status === 'ready' && (
        <div style={{ maxWidth: 'calc(var(--container-max) * 0.55)' }}>
          <SignInMethodsList
            connections={state.connections}
            onUnlink={handleUnlink}
            onSetPassword={onSetPassword}
            onLinkProvider={
              unlinkedProviders[0] ? () => handleConnectIntent(unlinkedProviders[0]) : undefined
            }
            disableUnlinkWhenOnlyMethod
          />

          {unlinkedProviders.length > 0 && (
            <div style={{ marginTop: 'var(--space-6)' }}>
              <h3
                style={{
                  margin: '0 0 var(--space-3)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-primary)',
                }}
              >
                {m.connections.addHeading}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {connectState.status === 'idle' &&
                  unlinkedProviders.map((provider) => (
                    <ConnectProviderButton
                      key={provider}
                      provider={provider}
                      onConnect={handleConnectIntent}
                    />
                  ))}

                {connectState.status === 'redirecting' && (
                  <StatusCallout
                    tone="info"
                    icon="↗"
                    title={t(m.connect.redirectingTitle, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                    data-state="redirecting"
                    data-provider={connectState.provider}
                    actions={
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          data-action="connect"
                          data-provider={connectState.provider}
                          onClick={() => void handleConfirmConnect(connectState.provider)}
                        >
                          {t(m.connect.continueButton, {
                            provider: providerDisplayName(connectState.provider),
                          })}
                        </Button>
                        <Button variant="ghost" size="sm" data-action="cancel" onClick={handleCancelConnect}>
                          {m.connect.cancel}
                        </Button>
                      </>
                    }
                  >
                    {t(m.connect.redirectingText, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                  </StatusCallout>
                )}

                {connectState.status === 'link-failed' && (
                  <StatusCallout
                    tone="error"
                    icon="⚠"
                    title={t(m.connect.linkFailedTitle, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                    data-state="link-failed"
                    data-provider={connectState.provider}
                    actions={
                      <Button
                        variant="primary"
                        size="sm"
                        data-action="connect"
                        data-provider={connectState.provider}
                        onClick={() => handleConnectIntent(connectState.provider)}
                      >
                        {m.connect.tryAgain}
                      </Button>
                    }
                  >
                    {t(m.connect.linkFailedText, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                  </StatusCallout>
                )}

                {connectState.status === 'already-linked' && (
                  <StatusCallout
                    tone="info"
                    icon="✓"
                    title={t(m.connect.alreadyLinkedTitle, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                    data-state="already-linked"
                    data-provider={connectState.provider}
                    actions={
                      onNavigate && (
                        <Button variant="ghost" size="sm" onClick={() => onNavigate(hubRoute)}>
                          {m.connect.viewConnected}
                        </Button>
                      )
                    }
                  >
                    {t(m.connect.alreadyLinkedText, {
                      provider: providerDisplayName(connectState.provider),
                    })}
                  </StatusCallout>
                )}
              </div>
              <p style={{ margin: 'var(--space-4) 0 0', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                {m.connections.addFootnote}
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
