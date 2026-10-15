import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Input } from '@fuzefront/design-system'
import { LockKeyhole, RefreshCw } from 'lucide-react'
import { QualityAction } from './components/primitives'

const TOKEN_KEY = 'fuzequality.session.token'
const TENANT_KEY = 'fuzequality.session.tenant'
const SESSION_ENDPOINT = '/api/v1/security/session'

type AuthenticatedSessionResponse = {
  status: 'authenticated'
  token: string
}

type MfaRequiredResponse = {
  status: 'mfa_required'
}

type SessionInfoResponse = {
  identity?: { tenantId?: string | null }
}

export type StandaloneSession = {
  token: string
  tenantId: string
}

type SessionResult = AuthenticatedSessionResponse | MfaRequiredResponse

export class StandaloneAuthenticationError extends Error {
  constructor(message: string, readonly code?: string) {
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

async function canonicalSession(token: string, fetcher: typeof fetch): Promise<StandaloneSession> {
  const response = await fetcher(SESSION_ENDPOINT, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => null) as SessionInfoResponse | null
  if (!response.ok) {
    throw new StandaloneAuthenticationError(
      errorMessage(body, 'Your FuzeFront session is no longer valid.'),
      response.status === 401 ? 'SESSION_EXPIRED' : 'SESSION_UNAVAILABLE',
    )
  }
  const tenantId = body?.identity?.tenantId
  if (!tenantId) {
    throw new StandaloneAuthenticationError(
      'Your account does not have an active personal or organization workspace.',
      'TENANT_UNRESOLVED',
    )
  }
  return { token, tenantId }
}

export async function restoreStandaloneSession(
  stored: StandaloneSession,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSession> {
  return canonicalSession(stored.token, fetcher)
}

export async function signInStandalone(
  email: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<StandaloneSession> {
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
    throw new StandaloneAuthenticationError(
      'This account requires an MFA step-up. Complete sign-in in the FuzeFront portal, then retry here.',
      'MFA_REQUIRED',
    )
  }
  if (body?.status !== 'authenticated' || !body.token) {
    throw new StandaloneAuthenticationError('FuzeFront returned an invalid session.', 'INVALID_SESSION')
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
    setError(undefined)
  }, [fetcher, session])

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      const authenticated = await signInStandalone(email, password, fetcher)
      saveStandaloneSession(authenticated)
      setSession(authenticated)
      setPassword('')
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSubmitting(false)
    }
  }, [email, fetcher, password])

  const content = useMemo(() => session ? children(session, signOut) : null, [children, session, signOut])
  if (checking) {
    return <main className="standalone-auth-state" aria-label="Restoring FuzeFront session"><RefreshCw className="spin" /> Restoring secure session…</main>
  }
  if (session) return content

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
        <form className="standalone-auth-form" onSubmit={submit}>
          <LockKeyhole aria-hidden="true" />
          <div><p className="eyebrow">Standalone session</p><h2>Sign in</h2></div>
          <Input label="Email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} />
          <Input label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <QualityAction type="submit" disabled={submitting || !email || !password}>
            {submitting ? <RefreshCw className="spin" size={14} /> : <LockKeyhole size={14} />}
            {submitting ? 'Signing in…' : 'Sign in securely'}
          </QualityAction>
        </form>
      </section>
    </main>
  )
}
