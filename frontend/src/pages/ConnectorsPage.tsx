import { useCallback, useEffect, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { getActiveAuthToken } from '../lib/accounts'

type GmailStatus = {
  provider: 'google-gmail'
  status: 'connected' | 'disconnected' | 'error'
  identity_email?: string
  configuration?: { query?: string; include_spam_trash?: boolean }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/connectors${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getActiveAuthToken() || ''}`,
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; detail?: string }
    throw new Error(payload.error || payload.detail || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export default function ConnectorsPage() {
  const [gmail, setGmail] = useState<GmailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('in:inbox')
  const [includeSpamTrash, setIncludeSpamTrash] = useState(false)

  const load = useCallback(async () => {
    try {
      const status = await request<GmailStatus>('/google-gmail')
      setGmail(status)
      setQuery(status.configuration?.query || 'in:inbox')
      setIncludeSpamTrash(Boolean(status.configuration?.include_spam_trash))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const connect = async () => {
    setBusy(true); setError('')
    try {
      const result = await request<{ authorization_url: string }>('/google-gmail/connect', { method: 'POST', body: '{}' })
      window.location.assign(result.authorization_url)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Gmail and delete its OAuth grant from FuzeKeys?')) return
    setBusy(true); setError('')
    try { await request('/google-gmail', { method: 'DELETE' }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const configure = async () => {
    setBusy(true); setError('')
    try {
      await request('/google-gmail', { method: 'PATCH', body: JSON.stringify({ query, include_spam_trash: includeSpamTrash }) })
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <main style={{ padding: 'var(--space-8)', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Connectors</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Connect accounts that FuzeFront agents may use on your behalf. Credentials stay in your FuzeKeys vault.</p>
      {error && <div role="alert" style={{ color: 'var(--error-color)', marginBottom: 'var(--space-4)' }}>{error}</div>}
      <section style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div aria-hidden="true" style={{ fontSize: '2rem' }}>✉️</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>Google Gmail</h2>
            <div style={{ color: 'var(--text-secondary)' }}>
              {gmail?.status === 'connected' ? `Connected as ${gmail.identity_email || 'Google user'}` : 'Not connected'}
            </div>
          </div>
          {gmail?.status === 'connected'
            ? <Button variant="secondary" disabled={busy} onClick={disconnect}>Disconnect</Button>
            : <Button variant="primary" disabled={busy || gmail === null} onClick={connect}>Connect</Button>}
        </div>
        {gmail?.status === 'connected' && (
          <div style={{ marginTop: 'var(--space-6)', display: 'grid', gap: 'var(--space-4)' }}>
            <label>Default Gmail search query
              <input value={query} onChange={e => setQuery(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 'var(--space-2)', padding: 'var(--space-3)' }} />
            </label>
            <label><input type="checkbox" checked={includeSpamTrash} onChange={e => setIncludeSpamTrash(e.target.checked)} /> Include spam and trash</label>
            <div><Button variant="primary" disabled={busy} onClick={configure}>Save configuration</Button></div>
          </div>
        )}
      </section>
    </main>
  )
}
