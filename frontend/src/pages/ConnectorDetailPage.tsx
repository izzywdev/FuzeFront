import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, LockKeyhole, Wrench } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@fuzefront/design-system'
import ConnectorIcon from '../components/ConnectorIcon'
import { ConnectorEntry, connectionLabel, connectorRequest, isConnectorStatus, withGmailCatalogEntry } from '../lib/connectors'
import { connectorProviderLink } from '../assets/connectorAssets'

export default function ConnectorDetailPage() {
  const { connectorId = '' } = useParams()
  const navigate = useNavigate()
  const [connector, setConnector] = useState<ConnectorEntry | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingAuthorization = new URLSearchParams(window.location.search).get('authorization_pending') === '1'

  const load = useCallback(async () => {
    setError('')
    try {
      const catalog = await connectorRequest<{ connectors: ConnectorEntry[] }>('/catalog')
      const definition = withGmailCatalogEntry(catalog.connectors).find(item => item.id === connectorId)
      if (!definition) { navigate('/connectors', { replace: true }); return }
      const status = await connectorRequest<ConnectorEntry>(`/${connectorId}`).catch(() => ({ status: 'error' as const }))
      if (!isConnectorStatus(status.status)) throw new Error('Invalid connector status')
      setConnector({ ...definition, ...status, ...(pendingAuthorization && status.status !== 'connected' ? { status: 'authorization_pending' } : {}) })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [connectorId, navigate])

  useEffect(() => { void load() }, [load])
  const connect = async () => {
    if (!connector) return
    setBusy(true); setError('')
    try {
      if (connector.authentication === 'api-key') {
        if (!apiKey.trim()) throw new Error('Enter an API key first')
        const result = await connectorRequest<{ status: 'connected' | 'authorization_pending' }>(`/${connector.id}/credential`, { method: 'POST', body: JSON.stringify({ api_key: apiKey.trim() }) })
        setApiKey('')
        if (result.status === 'authorization_pending') setConnector(current => current ? { ...current, status: 'authorization_pending' } : current)
        else await load()
      } else {
        const result = await connectorRequest<{ authorization_url: string }>(`/${connector.id}/connect`, { method: 'POST', body: '{}' })
        window.location.assign(result.authorization_url)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const disconnect = async () => {
    if (!connector || !window.confirm(`Disconnect ${connector.name} and remove its credential from FuzeKeys?`)) return
    setBusy(true); setError('')
    try { await connectorRequest(`/${connector.id}`, { method: 'DELETE' }); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const retryStatus = async () => {
    setBusy(true)
    try { await load() }
    finally { setBusy(false) }
  }
  const saveGmailConfiguration = async () => {
    if (!connector) return
    setBusy(true); setError('')
    try {
      await connectorRequest('/google-gmail', { method: 'PATCH', body: JSON.stringify({
        query: connector.configuration?.query || 'in:inbox', include_spam_trash: Boolean(connector.configuration?.include_spam_trash),
      }) })
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  if (!connector && !error) return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto', textAlign: 'left' }}><p role="status">Loading connector…</p></main>
  if (!connector) return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto', textAlign: 'left' }}><Link to="/connectors">Back to connectors</Link><p role="alert">{error}</p><button type="button" onClick={() => void load()}>Retry</button></main>
  const connected = connector.status === 'connected'
  const providerLink = connectorProviderLink(connector.id)

  return <main style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto', textAlign: 'left' }}>
    <Link to="/connectors" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 'var(--space-6)' }}><ArrowLeft size={17} /> All connectors</Link>
    <section style={{ border: '1px solid var(--border-color)', borderRadius: 18, padding: '28px', background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}><ConnectorIcon id={connector.id} name={connector.name} size={64} /><div><h1 style={{ margin: '2px 0 6px' }}>{connector.name}</h1><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{connector.description || 'Connect this tool to let FuzeFront use the access you authorize.'}</p></div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', marginTop: 22, borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
        <CheckCircle2 size={19} color={connected ? 'var(--success-color)' : 'var(--text-secondary)'} /><span style={{ flex: 1 }}><strong>{connectionLabel(connector)}</strong>{connected && <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '.9rem', marginTop: 2 }}>Available to this FuzeFront account.</span>}</span>
        {connector.status === 'error' && <button type="button" disabled={busy} onClick={() => void retryStatus()}>Retry status</button>}
        {connected ? <Button variant="secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button> : <Button variant="primary" disabled={busy || !connector.configured || connector.status === 'error' || (connector.authentication === 'api-key' && !apiKey.trim())} onClick={() => void connect()}>{connector.authentication === 'api-key' ? 'Save key' : 'Connect'}</Button>}
      </div>
      {connector.authentication === 'api-key' && !connected && <label style={{ display: 'block', marginTop: 20 }}>API key<input aria-label={`${connector.name} API key`} type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 7, padding: 11, borderRadius: 10, border: '1px solid var(--border-color)' }} /></label>}
      {connector.id === 'google-gmail' && connected && <fieldset style={{ border: 0, margin: '20px 0 0', padding: 0 }}><legend>Gmail settings</legend><label style={{ display: 'block', marginTop: 10 }}>Default search query<input aria-label="Default Gmail search query" value={connector.configuration?.query || 'in:inbox'} onChange={event => setConnector(current => current ? { ...current, configuration: { ...current.configuration, query: event.target.value } } : current)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 7, padding: 11, borderRadius: 10, border: '1px solid var(--border-color)' }} /></label><label style={{ display: 'block', marginTop: 10 }}><input type="checkbox" checked={Boolean(connector.configuration?.include_spam_trash)} onChange={event => setConnector(current => current ? { ...current, configuration: { ...current.configuration, include_spam_trash: event.target.checked } } : current)} /> Include spam and trash</label><Button variant="secondary" disabled={busy} onClick={() => void saveGmailConfiguration()}>Save Gmail settings</Button></fieldset>}
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
