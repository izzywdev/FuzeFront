import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Input } from '@fuzefront/design-system'
import { LockKeyhole, RefreshCw } from 'lucide-react'
import { QualityAction } from './components/primitives'

const TOKEN_KEY = 'fuzequality.session.token'
const TENANT_KEY = 'fuzequality.session.tenant'
const SESSION_ENDPOINT = '/api/v1/security/session'
const WORKSPACES_ENDPOINT = '/api/v1/security/session/workspaces'

type AuthenticatedSessionResponse = {
  status: 'authenticated'
  token: string
}

type MfaRequiredResponse = {
  status: 'mfa_required'
  challengeId: string
  factors: StandaloneMfaFactor[]
}

export type StandaloneMfaFactor = {
  factorId: string
  type: 'totp' | 'sms' | 'email'
}

export type StandaloneMfaChallenge = {
  status: 'mfa_required'
  challengeId: string
  factors: StandaloneMfaFactor[]
}

type SessionInfoResponse = {
  identity?: { tenantId?: string | null }
}

export type StandaloneWorkspace = {
  id: string
  name: string
  type: 'personal' | 'organization'
}

export type StandaloneWorkspaceSelection = {
  status: 'workspace_required'
  token: string
  workspaces: StandaloneWorkspace[]
}

export type StandaloneSession = {
  token: string
  tenantId: string
}

export function portalTokenProvider(hostWindow: Window = window): (() => string | null) | undefined {
  const context = (hostWindow as Window & {
    __FRONTFUSE_CONTEXT__?: { getAccessToken?: () => string | null }
  }).__FRONTFUSE_CONTEXT__
  return typeof context?.getAccessToken === 'function'
    ? () => context.getAccessToken?.() ?? null
    : undefined
}

type SessionResult = AuthenticatedSessionResponse | MfaRequiredResponse
type StandaloneSignInResult = StandaloneSession | StandaloneMfaChallenge | StandaloneWorkspaceSelection

export class StandaloneAuthenticationError extends Error {
  constructor(message: string, readonly code?: string, readonly retryToken?: string) {
    super(message)
    this.name = 'StandaloneAuthenticationError'
  }
}

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback
  const value = body as { error?: unknown; message?: unknown }
  return typeof value.error === 'string'
    ? value.error
    : typeof value.message === 'string'
      ? value.message
      : fallback
}

export function readStandaloneSession(storage: Pick<Storage, 'getItem'> = window.localStorage): StandaloneSession | null {
  const token = storage.getItem(TOKEN_KEY)
  const tenantId = storage.getItem(TENANT_KEY)
  return token && tenantId ? { token, tenantId } : null
}

export function saveStandaloneSession(
  session: StandaloneSession,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(TOKEN_KEY, session.token)
  storage.setItem(TENANT_KEY, session.tenantId)
}

export function clearStandaloneSession(
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
) {
  storage.removeItem(TOKEN_KEY)
  storage.removeItem(TENANT_KEY)
}

async function sessionTenant(token: string, fetcher: typeof fetch, tenantId?: string): Promise<string | null> {
  const endpoint = tenantId
    ? `${SESSION_ENDPOINT}?tenant=${encodeURIComponent(tenantId)}`
    : SESSION_ENDPOINT
  const response = await fetcher(endpoint, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null) as SessionInfoResponse | null
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'Your FuzeFront session is no longer valid.'),
      response.status === 401 ? 'SESSION_EXPIRED' : 'SESSION_UNAVAILABLE',
    )
  }
  return body?.identity?.tenantId ?? null
}

async function availableWorkspaces(token: string, fetcher: typeof fetch): Promise<StandaloneWorkspace[]> {
  const response = await fetcher(WORKSPACES_ENDPOINT, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null) as { workspaces?: StandaloneWorkspace[] } | null
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'Your FuzeFront workspaces could not be loaded.'),
      response.status === 401
        ? 'SESSION_EXPIRED'
        : response.status === 503
          ? 'WORKSPACES_UNAVAILABLE'
          : 'WORKSPACES_FAILED',
    )
  }
  return Array.isArray(body?.workspaces) ? body.workspaces : []
}

async function canonicalSession(
  token: string,
  fetcher: typeof fetch,
  preferredTenantId?: string,
): Promise<StandaloneSession | StandaloneWorkspaceSelection> {
  const tenantId = await sessionTenant(token, fetcher, preferredTenantId)
  if (tenantId) return { token, tenantId }
  if (preferredTenantId) {
    throw new StandaloneAuthenticationError(
      'Your selected workspace is no longer available.',
      'TENANT_UNRESOLVED',
    )
  }

  let workspaces: StandaloneWorkspace[]
  try {
    workspaces = await availableWorkspaces(token, fetcher)
  } catch (error) {
    if (error instanceof StandaloneAuthenticationError && error.code === 'WORKSPACES_UNAVAILABLE') {
      throw new StandaloneAuthenticationError(error.message, error.code, token)
    }
    throw error
  }
  if (workspaces.length === 1) return canonicalSession(token, fetcher, workspaces[0].id)
  if (workspaces.length > 1) return { status: 'workspace_required', token, workspaces }
  throw new StandaloneAuthenticationError(
    'Your account does not have an active personal or organization workspace.',
    'TENANT_UNRESOLVED',
  )
}

export async function restoreStandaloneSession(
  stored: StandaloneSession,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSession> {
  const restored = await canonicalSession(stored.token, fetcher, stored.tenantId)
  if ('status' in restored) throw new StandaloneAuthenticationError('Your selected workspace is no longer available.', 'TENANT_UNRESOLVED')
  return restored
}

export async function selectStandaloneWorkspace(
  selection: StandaloneWorkspaceSelection,
  tenantId: string,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSession> {
  if (!selection.workspaces.some(workspace => workspace.id === tenantId)) {
    throw new StandaloneAuthenticationError('Select an available workspace.', 'TENANT_UNRESOLVED')
  }
  const selected = await canonicalSession(selection.token, fetcher, tenantId)
  if ('status' in selected) throw new StandaloneAuthenticationError('The selected workspace could not be verified.', 'TENANT_UNRESOLVED')
  return selected
}

export async function signInStandalone(
  email: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSignInResult> {
  const response = await fetcher(SESSION_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await response.json().catch(() => null) as SessionResult | null
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'Sign-in failed. Check your email and password.'),
      response.status === 401 ? 'INVALID_CREDENTIALS' : 'AUTHENTICATION_UNAVAILABLE',
    )
  }
  if (body?.status === 'mfa_required') {
    if (!body.challengeId || !body.factors?.length) {
      throw new StandaloneAuthenticationError('FuzeFront returned an invalid MFA challenge.', 'INVALID_MFA_CHALLENGE')
    }
    return body
  }
  if (body?.status !== 'authenticated' || !body.token) {
    throw new StandaloneAuthenticationError('FuzeFront returned an invalid session.', 'INVALID_SESSION')
  }
  return canonicalSession(body.token, fetcher)
}

export async function challengeStandaloneMfa(
  challengeId: string,
  factorId: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/v1/security/mfa/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, factorId }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'Could not start additional verification.'),
      'MFA_CHALLENGE_FAILED',
    )
  }
}

export async function verifyStandaloneMfa(
  challengeId: string,
  factorId: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSession | StandaloneWorkspaceSelection> {
  const response = await fetcher('/api/v1/security/mfa/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, factorId, code }),
  })
  const body = await response.json().catch(() => null) as { token?: string } | null
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'The verification code was not accepted.'),
      response.status === 401 ? 'INVALID_MFA_CODE' : 'MFA_VERIFICATION_FAILED',
    )
  }
  if (!body?.token) {
    throw new StandaloneAuthenticationError('FuzeFront returned an invalid verified session.', 'INVALID_SESSION')
  }
  return canonicalSession(body.token, fetcher)
}

async function revokeStandaloneSession(token: string, fetcher: typeof fetch) {
  await fetcher(SESSION_ENDPOINT, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => undefined)
}

export function StandaloneAuthBoundary({
  children,
  fetcher = fetch,
}: {
  children: (session: StandaloneSession, signOut: () => void) => ReactNode
  fetcher?: typeof fetch
}) {
  const [session, setSession] = useState<StandaloneSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfa, setMfa] = useState<StandaloneMfaChallenge | null>(null)
  const [workspaceSelection, setWorkspaceSelection] = useState<StandaloneWorkspaceSelection | null>(null)
  const [workspaceRetryToken, setWorkspaceRetryToken] = useState<string>()
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  const restore = useCallback(async () => {
    const stored = readStandaloneSession()
    if (!stored) {
      setChecking(false)
      return
    }
    setChecking(true)
    setError(undefined)
    try {
      const canonical = await restoreStandaloneSession(stored, fetcher)
      saveStandaloneSession(canonical)
      setSession(canonical)
    } catch (value) {
      clearStandaloneSession()
      setSession(null)
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setChecking(false)
    }
  }, [fetcher])

  useEffect(() => {
    void restore()
  }, [restore])

  const signOut = useCallback(() => {
    if (session) void revokeStandaloneSession(session.token, fetcher)
    clearStandaloneSession()
    setSession(null)
    setPassword('')
    setMfa(null)
    setWorkspaceSelection(null)
    setWorkspaceRetryToken(undefined)
    setFactorId('')
    setCode('')
    setError(undefined)
  }, [fetcher, session])

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    setWorkspaceRetryToken(undefined)
    try {
      const result = await signInStandalone(email, password, fetcher)
      if ('status' in result && result.status === 'mfa_required') {
        const selectedFactor = result.factors[0].factorId
        await challengeStandaloneMfa(result.challengeId, selectedFactor, fetcher)
        setMfa(result)
        setFactorId(selectedFactor)
        setPassword('')
      } else if ('status' in result) {
        setWorkspaceSelection(result)
        setPassword('')
      } else {
        saveStandaloneSession(result)
        setSession(result)
        setPassword('')
      }
    } catch (value) {
      if (value instanceof StandaloneAuthenticationError && value.retryToken) {
        setWorkspaceRetryToken(value.retryToken)
      }
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [email, fetcher, password])

  const retryWorkspaceDiscovery = useCallback(async () => {
    if (!workspaceRetryToken) return
    setSubmitting(true)
    setError(undefined)
    const retryToken = workspaceRetryToken
    setWorkspaceRetryToken(undefined)
    try {
      const result = await canonicalSession(retryToken, fetcher)
      if ('status' in result) {
        setWorkspaceSelection(result)
      } else {
        saveStandaloneSession(result)
        setSession(result)
      }
      setWorkspaceRetryToken(undefined)
    } catch (value) {
      if (value instanceof StandaloneAuthenticationError && value.retryToken) {
        setWorkspaceRetryToken(value.retryToken)
      }
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [fetcher, workspaceRetryToken])

  const chooseFactor = useCallback(async (nextFactorId: string) => {
    if (!mfa) return
    setSubmitting(true)
    setError(undefined)
    try {
      await challengeStandaloneMfa(mfa.challengeId, nextFactorId, fetcher)
      setFactorId(nextFactorId)
      setCode('')
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [fetcher, mfa])

  const verify = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!mfa || !factorId) return
    setSubmitting(true)
    setError(undefined)
    try {
      const authenticated = await verifyStandaloneMfa(mfa.challengeId, factorId, code, fetcher)
      if ('status' in authenticated) {
        setWorkspaceSelection(authenticated)
      } else {
        saveStandaloneSession(authenticated)
        setSession(authenticated)
      }
      setMfa(null)
      setCode('')
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [code, factorId, fetcher, mfa])

  const chooseWorkspace = useCallback(async (tenantId: string) => {
    if (!workspaceSelection) return
    setSubmitting(true)
    setError(undefined)
    try {
      const authenticated = await selectStandaloneWorkspace(workspaceSelection, tenantId, fetcher)
      saveStandaloneSession(authenticated)
      setSession(authenticated)
      setWorkspaceSelection(null)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [fetcher, workspaceSelection])

  const content = useMemo(() => session ? children(session, signOut) : null, [children, session, signOut])
  if (checking) {
    return <main className="standalone-auth-state" aria-label="Restoring FuzeFront session"><RefreshCw className="spin" /> Restoring secure session…</main>
  }
  if (session) return content

  if (workspaceSelection) {
    return (
      <main className="standalone-auth-shell">
        <section className="standalone-auth-brand" aria-labelledby="standalone-workspace-title">
          <div className="brand standalone-auth-lockup">
            <div className="brand-symbol" aria-hidden="true"><span /><span /><span /></div>
            <div><strong>FuzeQuality</strong><small>Evidence control</small></div>
          </div>
          <div><p className="eyebrow">FuzeFront secure access</p><h1 id="standalone-workspace-title">Choose your workspace.</h1><p>Personal installations stay private. Organization installations are shared across the organization.</p></div>
        </section>
        <section className="standalone-auth-panel">
          <div className="standalone-auth-form" role="group" aria-label="Available workspaces">
            <LockKeyhole aria-hidden="true" />
            <div><p className="eyebrow">Workspace scope</p><h2>Continue to FuzeQuality</h2></div>
            {workspaceSelection.workspaces.map(workspace => (
              <QualityAction key={workspace.id} type="button" disabled={submitting} onClick={() => void chooseWorkspace(workspace.id)}>
                {workspace.name} · {workspace.type === 'personal' ? 'Personal' : 'Organization'}
              </QualityAction>
            ))}
            {error && <p className="form-error" role="alert">{error}</p>}
            <QualityAction type="button" intent="quiet" disabled={submitting} onClick={() => { setWorkspaceSelection(null); setError(undefined) }}>Back to sign in</QualityAction>
          </div>
        </section>
      </main>
    )
  }

  const activeFactor = mfa?.factors.find(factor => factor.factorId === factorId)

  return (
    <main className="standalone-auth-shell">
      <section className="standalone-auth-brand" aria-labelledby="standalone-auth-title">
        <div className="brand standalone-auth-lockup">
          <div className="brand-symbol" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>FuzeQuality</strong><small>Evidence control</small></div>
        </div>
        <div>
          <p className="eyebrow">FuzeFront secure access</p>
          <h1 id="standalone-auth-title">Quality evidence, wherever work ships.</h1>
          <p>Sign in with your FuzeFront account to open your personal workspace or organization-wide installation.</p>
        </div>
      </section>
      <section className="standalone-auth-panel">
        <form className="standalone-auth-form" onSubmit={mfa ? verify : submit}>
          <LockKeyhole aria-hidden="true" />
          <div><p className="eyebrow">Standalone session</p><h2>{mfa ? 'Verify your identity' : 'Sign in'}</h2></div>
          {mfa ? (
            <>
              <label className="standalone-auth-field">
                <span>Verification method</span>
                <select aria-label="Verification method" value={factorId} disabled={submitting} onChange={event => void chooseFactor(event.target.value)}>
                  {mfa.factors.map(factor => <option key={factor.factorId} value={factor.factorId}>{factor.type === 'totp' ? 'Authenticator app' : factor.type === 'sms' ? 'Text message' : 'Email'}</option>)}
                </select>
              </label>
              <p className="standalone-auth-hint">{activeFactor?.type === 'totp' ? 'Enter the current code from your authenticator app.' : `A one-time code was sent by ${activeFactor?.type === 'sms' ? 'text message' : 'email'}.`}</p>
              <Input label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} />
            </>
          ) : (
            <>
              <Input label="Email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} />
              <Input label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {workspaceRetryToken && !mfa && (
            <QualityAction type="button" intent="quiet" disabled={submitting} onClick={() => void retryWorkspaceDiscovery()}>
              <RefreshCw size={14} /> Retry workspace discovery
            </QualityAction>
          )}
          <QualityAction type="submit" disabled={submitting || (mfa ? !code : !email || !password)}>
            {submitting ? <RefreshCw className="spin" size={14} /> : <LockKeyhole size={14} />}
            {submitting ? (mfa ? 'Verifying…' : 'Signing in…') : (mfa ? 'Verify and continue' : 'Sign in securely')}
          </QualityAction>
          {mfa && <QualityAction type="button" intent="quiet" disabled={submitting} onClick={() => { setMfa(null); setFactorId(''); setCode(''); setError(undefined) }}>Back to sign in</QualityAction>}
        </form>
      </section>
    </main>
  )
}
