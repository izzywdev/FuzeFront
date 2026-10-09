import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import ConnectorIcon from '../components/ConnectorIcon'
import { ConnectorEntry, connectionLabel, connectorRequest } from '../lib/connectors'

export default function ConnectorsPage() {
  const generation = useRef(0)
  const pendingId = new URLSearchParams(window.location.search).get('authorization_pending') || ''
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError('')
    try {
      const catalog = await connectorRequest<{ connectors: ConnectorEntry[] }>('/catalog')
      if (current !== generation.current) return
      const entries = catalog.connectors.map(entry => ({ ...entry, status: 'loading' as const }))
      setConnectors(entries)
      await Promise.all(entries.map(async entry => {
        try {
          const status = await connectorRequest<ConnectorEntry>(`/${entry.id}`)
          const resolved = pendingId === entry.id && status.status !== 'connected' ? { ...status, status: 'authorization_pending' as const } : status
          if (current === generation.current) setConnectors(all => all.map(item => item.id === entry.id ? { ...entry, ...resolved } : item))
        } catch {
          const status = pendingId === entry.id ? 'authorization_pending' as const : 'error' as const
          if (current === generation.current) setConnectors(all => all.map(item => item.id === entry.id ? { ...entry, status } : item))
        }
      }))
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [pendingId])

  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  const visible = connectors.filter(item => `${item.name} ${item.description || ''}`.toLowerCase().includes(query.toLowerCase()))
  const hasStatusError = connectors.some(item => item.status === 'error')

  return <main style={{ padding: 'var(--space-8)', maxWidth: 960, margin: '0 auto' }}>
    <header style={{ marginBottom: 'var(--space-6)' }}>
      <h1 style={{ margin: 0, letterSpacing: '-0.02em' }}>Connectors</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>Connect the tools FuzeFront can use on your behalf. Your credentials stay in FuzeKeys.</p>
    </header>
    {pendingId && <p role="status" style={{ marginTop: 0 }}>Connection awaiting approval. Contact your administrator, then connect again.</p>}
    <label style={{ position: 'relative', display: 'block', marginBottom: 'var(--space-5)' }}>
      <Search aria-hidden="true" size={18} style={{ position: 'absolute', left: 14, top: 13, color: 'var(--text-secondary)' }} />
      <input aria-label="Search connectors" placeholder="Search connectors" value={query} onChange={event => setQuery(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 42px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }} />
    </label>
    {error && <div role="alert" style={{ color: 'var(--error-color)', marginBottom: 'var(--space-4)' }}>{error} <button onClick={() => void load()}>Retry</button></div>}
    {!error && hasStatusError && <button onClick={() => void load()} style={{ marginBottom: 'var(--space-4)' }}>Retry</button>}
    {loading && !connectors.length ? <p role="status">Loading connector catalog…</p> :
      <section aria-label="Connector catalog" style={{ border: '1px solid var(--border-color)', borderRadius: 18, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        {visible.map((connector, index) => <Link key={connector.id} to={`/connectors/${encodeURIComponent(connector.id)}`} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', color: 'inherit', textDecoration: 'none', borderTop: index ? '1px solid var(--border-color)' : undefined }}>
          <ConnectorIcon id={connector.id} name={connector.name} />
          <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', fontSize: '1rem' }}>{connector.name}</strong><span style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connector.description || connectionLabel(connector)}</span></span>
          <span style={{ color: connector.status === 'connected' ? 'var(--success-color)' : 'var(--text-secondary)', fontSize: '.9rem', textAlign: 'right' }}>{connectionLabel(connector)}</span>
          <ChevronRight aria-hidden="true" size={20} color="var(--text-secondary)" />
        </Link>)}
        {!visible.length && <p style={{ padding: 'var(--space-6)', margin: 0, color: 'var(--text-secondary)' }}>No connectors match that search.</p>}
      </section>}
  </main>
}
