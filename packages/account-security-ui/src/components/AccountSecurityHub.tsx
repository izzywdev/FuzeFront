import React, { useCallback, useEffect, useState } from 'react'
import {
  AccountSecurityI18nProvider,
  type AccountSecurityLocale,
} from '../i18n/AccountSecurityI18nProvider'
import { useAccountSecurityI18n } from '../i18n/AccountSecurityI18nProvider'
import { SecurityHub, type SecurityHubRoutes } from './SecurityHub'
import { SecurityCardGridSkeleton } from './SecurityCardGridSkeleton'
import { LoadErrorRetry } from './LoadErrorRetry'
import { createAccountSecurityClient } from '../api/securityClient'
import type { AccountSecurityClient, SecurityOverview } from '../types'

export interface AccountSecurityHubProps {
  /** Injected client (tests/host). Defaults to a same-origin client. */
  client?: AccountSecurityClient
  /** Bearer-token accessor for the default client. */
  getToken?: () => string | null | undefined
  locale?: AccountSecurityLocale
  onNavigate?: (route: string) => void
  onSetPassword?: () => void
  routes?: Partial<SecurityHubRoutes>
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; overview: SecurityOverview }

/**
 * Flow orchestrator for `/account/security` (frames 01 + 02). Loads the account's
 * connections + auth methods (and, best-effort, the active-device count) and
 * renders every contract state: loading skeleton, load-error + retry, and the
 * hub (which itself surfaces the social-only set-password guard). Fail-closed:
 * a load error never shows a partial/permissive hub.
 */
export function AccountSecurityHub(props: AccountSecurityHubProps) {
  const locale = props.locale ?? 'en'
  return (
    <AccountSecurityI18nProvider locale={locale}>
      <AccountSecurityHubInner {...props} />
    </AccountSecurityI18nProvider>
  )
}

function AccountSecurityHubInner({
  client,
  getToken,
  onNavigate,
  onSetPassword,
  routes,
}: AccountSecurityHubProps) {
  const { messages: m, dir } = useAccountSecurityI18n()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const api = React.useMemo(
    () => client ?? createAccountSecurityClient({ getToken }),
    [client, getToken]
  )

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const [connections, methods] = await Promise.all([api.getConnections(), api.getMethods()])
      // Active-device count is best-effort; an unknown count renders honestly,
      // it never fails the whole hub.
      let activeSessions: number | null = null
      if (api.getActiveSessionCount) {
        try {
          activeSessions = await api.getActiveSessionCount()
        } catch {
          activeSessions = null
        }
      }
      setState({
        status: 'ready',
        overview: {
          connections,
          methods,
          activeSessions,
          // No token-count endpoint on the Security contract yet — honest unknown.
          activeTokens: null,
        },
      })
    } catch {
      setState({ status: 'error' })
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main
      dir={dir}
      data-frame="account-security"
      style={{ maxWidth: 'calc(var(--container-max) * 0.6)', fontFamily: 'var(--font-sans)' }}
    >
      <h1
        style={{
          margin: '0 0 var(--space-1)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
          color: 'var(--text-primary)',
        }}
      >
        {m.page.title}
      </h1>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>
        {m.page.subtitle}
      </p>

      {state.status === 'loading' && <SecurityCardGridSkeleton />}
      {state.status === 'error' && <LoadErrorRetry onRetry={() => void load()} />}
      {state.status === 'ready' && (
        <SecurityHub
          overview={state.overview}
          onNavigate={onNavigate}
          onSetPassword={onSetPassword}
          routes={routes}
        />
      )}
    </main>
  )
}
