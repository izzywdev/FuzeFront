import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, LockKeyhole, Wrench } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@fuzefront/design-system'
import ConnectorIcon from '../components/ConnectorIcon'
import { ConnectorEntry, connectionLabel, connectorRequest } from '../lib/connectors'
import { connectorProviderLink } from '../assets/connectorAssets'

export default function ConnectorDetailPage() {
  const { connectorId = '' } = useParams()
  const navigate = useNavigate()
  const [connector, setConnector] = useState<ConnectorEntry | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const catalog = await connectorRequest<{ connectors: ConnectorEntry[] }>('/catalog')
      const definition = catalog.connectors.find(item => item.id === connectorId)
      if (!definition) { navigate('/connectors', { replace: true }); return }
      const status = await connectorRequest<ConnectorEntry>(`/${connectorId}`).catch(() => ({ status: 'error' as const }))
      setConnector({ ...definition, ...status })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [connectorId, navigate])

  useEffect(() => { void load() }, [load])
  const connect = async () => {
    if (!connector) return
    setBusy(true); setError('')
    try {
      if (connector.authentication === 'api-key') {
        if (!apiKey.trim()) throw new Error('Enter an API key first')
        await connectorRequest(`/${connector.id}/credential`, { method: 'POST', body: JSON.stringify({ api_key: apiKey.trim() }) })
        setApiKey(''); await load()
      } else {
        const result = await connectorRequest<{ authorization_url: string }>(`/${connector.id}/connect`, { method: 'POST', body: '{}' })
        window.location.assign(result.authorization_url)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) }
  }
  const disconnect = async () => {
    if (!connector || !window.confirm(`Disconnect ${connector.name} and remove its credential from FuzeKeys?`)) return
    setBusy(true); setError('')
    try { await connectorRequest(`/${connector.id}`, { method: 'DELETE' }); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  if (!connector && !error) return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto' }}><p role="status">Loading connector…</p></main>
  if (!connector) return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto' }}><Link to="/connectors">Back to connectors</Link><p role="alert">{error}</p></main>
  const connected = connector.status === 'connected'
  const providerLink = connectorProviderLink(connector.id)

  return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto' }}>
    <Link to="/connectors" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 'var(--space-6)' }}><ArrowLeft size={17} /> All connectors</Link>
    <section style={{ border: '1px solid var(--border-color)', borderRadius: 18, padding: '28px', background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}><ConnectorIcon id={connector.id} name={connector.name} size={64} /><div><h1 style={{ margin: '2px 0 6px' }}>{connector.name}</h1><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{connector.description || 'Connect this tool to let FuzeFront use the access you authorize.'}</p></div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', marginTop: 22, borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
        <CheckCircle2 size={19} color={connected ? 'var(--success-color)' : 'var(--text-secondary)'} /><span style={{ flex: 1 }}><strong>{connectionLabel(connector)}</strong>{connected && <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '.9rem', marginTop: 2 }}>Available to this FuzeFront account.</span>}</span>
        {connected ? <Button variant="secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button> : <Button variant="primary" disabled={busy || !connector.configured || connector.status === 'error'} onClick={() => void connect()}>{connector.authentication === 'api-key' ? 'Save key' : 'Connect'}</Button>}
      </div>
      {connector.authentication === 'api-key' && !connected && <label style={{ display: 'block', marginTop: 20 }}>API key<input aria-label={`${connector.name} API key`} type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 7, padding: 11, borderRadius: 10, border: '1px solid var(--border-color)' }} /></label>}
      {!connector.configured && <p style={{ marginBottom: 0, color: 'var(--text-secondary)' }}>This provider still needs administrator setup before it can be connected.</p>}
      {error && <p role="alert" style={{ color: 'var(--error-color)', marginBottom: 0 }}>{error}</p>}
      {providerLink && <a href={providerLink.href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 20, color: 'var(--primary-color)' }}>{providerLink.label}<ExternalLink size={15} /></a>}
    </section>
    <section style={{ marginTop: 22, border: '1px solid var(--border-color)', borderRadius: 18, overflow: 'hidden' }}>
      <InfoRow icon={<Wrench size={19} />} title="What FuzeFront can do" detail={connector.authentication === 'api-key' ? 'Use the API access that you explicitly provide.' : 'Use only the OAuth permissions that you approve during connection.'} />
      <InfoRow icon={<LockKeyhole size={19} />} title="How credentials are handled" detail="Credentials are stored and retrieved through FuzeKeys, scoped to your selected organization and account." />
      <InfoRow icon={<KeyRound size={19} />} title="Connection controls" detail="You can disconnect this connector at any time. Disconnecting removes its stored credential." last />
    </section>
  </main>
}

function InfoRow({ icon, title, detail, last = false }: { icon: ReactNode; title: string; detail: string; last?: boolean }) {
  return <div style={{ display: 'flex', gap: 14, padding: 20, borderBottom: last ? undefined : '1px solid var(--border-color)' }}><span style={{ color: 'var(--text-secondary)' }}>{icon}</span><div><strong>{title}</strong><p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '.92rem' }}>{detail}</p></div></div>
}
