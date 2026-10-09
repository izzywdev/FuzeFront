import { useState } from 'react'
import { connectorIconSource, connectorInitials } from '../assets/connectorAssets'

export default function ConnectorIcon({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const source = connectorIconSource(id)
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 12, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'inline-grid', placeItems: 'center', flex: '0 0 auto', overflow: 'hidden', color: 'var(--primary-color)', fontWeight: 700, fontSize: Math.max(12, size / 2.7) }}>
      {source && !failed
        ? <img src={source} alt="" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} onError={() => setFailed(true)} />
        : connectorInitials(name)}
    </span>
  )
}
