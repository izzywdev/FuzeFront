import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { getActiveAuthToken } from '../lib/accounts'

type GmailStatus = {
  provider: 'google-gmail'
  status: 'connected' | 'disconnected' | 'error' | 'authorization_pending'
  identity_email?: string
  configuration?: { query?: string; include_spam_trash?: boolean }
}

type ConnectorEntry = { id: string; name: string; authentication?: 'oauth' | 'api-key'; configured?: boolean; status?: 'connected' | 'disconnected' | 'error' | 'authorization_pending' | 'loading'; identity_email?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), !init?.method || init.method === 'GET' ? 10_000 : 30_000)
  try {
    const response = await fetch(`/api/v1/connectors${path}`, {
      ...init,
      signal: controller.signal,
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
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Connector request timed out. Retry.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export default function ConnectorsPage() {
  const loadGeneration = useRef(0)
  const pending = useRef(new Set<string>([new URLSearchParams(window.location.search).get('authorization_pending') || ''].filter(value => /^[a-z][a-z0-9-]{1,63}$/.test(value))))
  const [notice, setNotice] = useState(pending.current.size ? 'Connection awaiting approval. Contact your administrator, then connect again.' : '')
  const [gmail, setGmail] = useState<GmailStatus | null>(null)
  const [gmailLoading, setGmailLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [otherConnectors, setOtherConnectors] = useState<ConnectorEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('in:inbox')
  const [includeSpamTrash, setIncludeSpamTrash] = useState(false)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const current = () => generation === loadGeneration.current
    setError('')
    setCatalogLoading(true)
    setGmailLoading(true)
    // Gmail and per-provider status must never gate catalog visibility.
    const gmailRequest = request<GmailStatus>('/google-gmail').then(status => {
      if (!current()) return
      if (!['connected', 'disconnected', 'authorization_pending', 'error'].includes(status.status)) throw new Error('Invalid Gmail connection status')
      setGmail(status.status === 'connected' || !pending.current.has('google-gmail') ? status : { provider: 'google-gmail', status: 'authorization_pending' })
      setQuery(status.configuration?.query || 'in:inbox')
      setIncludeSpamTrash(Boolean(status.configuration?.include_spam_trash))
    }).catch(() => { if (current()) setGmail({ provider: 'google-gmail', status: 'error' }) })
      .finally(() => { if (current()) setGmailLoading(false) })
    try {
      const catalog = await request<{ connectors: ConnectorEntry[] }>('/catalog')
      if (!current()) return
      const entries = catalog.connectors.filter(item => item.id !== 'google-gmail')
      setOtherConnectors(entries.map(item => ({ ...item, status: 'loading' })))
      setCatalogLoading(false)
      await Promise.all(entries.map(async item => {
        let resolved: ConnectorEntry
        try {
          const result = await request<ConnectorEntry>(`/${item.id}`)
          if (!result.status || !['connected', 'disconnected', 'authorization_pending', 'error'].includes(result.status)) throw new Error('Invalid connector status')
          resolved = { ...item, ...result, id: item.id, name: item.name, ...(pending.current.has(item.id) && result.status !== 'connected' ? { status: 'authorization_pending' as const } : {}) }
        }
        catch { resolved = { ...item, status: pending.current.has(item.id) ? 'authorization_pending' : 'error' } }
        if (current()) setOtherConnectors(entries => entries.map(entry => entry.id === item.id ? resolved : entry))
      }))
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current()) setCatalogLoading(false)
    }
    await gmailRequest
  }, [])

  useEffect(() => { void load(); return () => { loadGeneration.current++ } }, [load])

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

  const connectOther = async (id: string) => {
    setBusy(true); setError('')
    try {
      const result = await request<{ authorization_url: string }>(`/${id}/connect`, { method: 'POST', body: '{}' })
      window.location.assign(result.authorization_url)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false) }
  }

  const connectWithKey = async (id: string) => {
    const key = apiKeys[id]?.trim()
    if (!key) { setError('Enter an API key first'); return }
    setBusy(true); setError('')
    try {
      const result = await request<{ status: string }>(`/${id}/credential`, { method: 'POST', body: JSON.stringify({ api_key: key }) })
      if (result.status === 'authorization_pending') {
        pending.current.add(id)
        setNotice('Connection awaiting approval. Contact your administrator, then connect again.')
      } else if (result.status === 'connected') { pending.current.delete(id); setNotice('') }
      else { throw new Error('Connection was not confirmed') }
      setApiKeys(current => ({ ...current, [id]: '' }))
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const disconnectOther = async (id: string) => {
    if (!window.confirm(`Disconnect ${id} and delete its stored OAuth grant?`)) return
    setBusy(true); setError('')
    try { await request(`/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <main style={{ padding: 'var(--space-8)', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Connectors</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Connect accounts that FuzeFront agents may use on your behalf. Credentials stay in your FuzeKeys vault.</p>
      {notice && <div role="status" style={{ marginBottom: 'var(--space-4)' }}>{notice}</div>}
      {error && <div role="alert" style={{ color: 'var(--error-color)', marginBottom: 'var(--space-4)' }}>{error}</div>}
      {catalogLoading && <p role="status">Loading connector catalog…</p>}
      {(error || gmail?.status === 'error' || otherConnectors.some(item => item.status === 'error')) &&
        <Button variant="secondary" disabled={busy || catalogLoading} onClick={() => void load()}>Retry</Button>}
      <section style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div aria-hidden="true" style={{ fontSize: '2rem' }}>✉️</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>Google Gmail</h2>
            <div style={{ color: 'var(--text-secondary)' }}>
              {gmailLoading ? 'Loading connection status…' : gmail?.status === 'connected' ? `Connected as ${gmail.identity_email || 'Google user'}` : gmail?.status === 'authorization_pending' ? 'Awaiting approval — connect again after approval' : gmail?.status === 'error' ? 'Status unavailable' : 'Not connected'}
            </div>
          </div>
          {gmail?.status === 'connected'
            ? <Button variant="secondary" disabled={busy || gmailLoading} onClick={disconnect}>Disconnect</Button>
            : <Button variant="primary" disabled={busy || gmailLoading || gmail === null || gmail.status === 'error'} onClick={connect}>Connect</Button>}
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
      <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        {otherConnectors.map(item => <section key={item.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{item.name}</h2>
            <div style={{ color: 'var(--text-secondary)' }}>{item.status === 'loading' ? 'Loading connection status…' : item.status === 'connected' ? `Connected${item.identity_email ? ` as ${item.identity_email}` : ''}` : item.status === 'authorization_pending' ? 'Awaiting approval — connect again after approval' : item.status === 'error' ? 'Status unavailable' : !item.configured ? 'Provider setup pending' : 'Not connected'}</div>
          </div>
          {item.authentication === 'api-key' && item.status !== 'connected' && item.configured &&
            <label>API key
              <input type="password" autoComplete="off" value={apiKeys[item.id] || ''}
                onChange={e => setApiKeys(current => ({ ...current, [item.id]: e.target.value }))}
                aria-label={`${item.name} API key`} />
            </label>}
          {item.status === 'connected'
            ? <Button variant="secondary" disabled={busy} onClick={() => void disconnectOther(item.id)}>Disconnect</Button>
            : item.authentication === 'api-key'
              ? <Button variant="primary" disabled={busy || !item.configured || item.status === 'loading' || item.status === 'error' || !apiKeys[item.id]?.trim()} onClick={() => void connectWithKey(item.id)}>Save key</Button>
              : <Button variant="primary" disabled={busy || !item.configured || item.status === 'loading' || item.status === 'error'} onClick={() => void connectOther(item.id)}>Connect</Button>}
        </section>)}
      </div>
    </main>
  )
}
