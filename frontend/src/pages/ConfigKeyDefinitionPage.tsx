import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { KeyDefinitionDetail, ConfigI18nProvider, type ChainStep } from '@fuzefront/config-ui'
import { ConfigClient, isNotModified } from '@fuzefront/config-client'
import type { KeyDefinition, Scope } from '@fuzefront/config-client'
import { getActiveAuthToken } from '../lib/accounts'

const CONFIG_API_BASE = '/api/config'

/**
 * `/admin/config/catalog/:key` (flag `fuzefront.config.key-catalog`) — one
 * `KeyDefinition` plus the resolution chain, frame 06. Only `platform` is
 * always readable; a second read is attempted at the caller's active
 * organization when `?ns=` + an org context are both available. Portal/user
 * tiers are omitted — see `ConfigPage`'s doc comment (FF-EPIC-10's
 * `buildScopeChain` limitation).
 */
function ConfigKeyDefinitionPage() {
  const { key } = useParams<{ key: string }>()
  const [searchParams] = useSearchParams()
  const namespace = searchParams.get('ns')
  const navigate = useNavigate()

  const client = useRef(new ConfigClient({ baseUrl: CONFIG_API_BASE, token: () => getActiveAuthToken() ?? undefined })).current

  const [definition, setDefinition] = useState<KeyDefinition | null>(null)
  const [chain, setChain] = useState<ChainStep[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!namespace || !key) return
    let cancelled = false

    async function run() {
      try {
        const def = await client.getKeyDefinition(namespace!, key!)
        if (cancelled) return
        setDefinition(def)

        const platform: Scope = { scopeType: 'platform' }
        const platformRead = await client.getEffectiveConfig(namespace!, platform)
        if (cancelled) return
        const platformEntry = isNotModified(platformRead) ? undefined : platformRead.entries.find(e => e.key === key)

        const steps: ChainStep[] = [
          {
            scope: platform,
            value: def.defaultValue,
            effective: !platformEntry || platformEntry.source.scopeType === 'platform',
          },
        ]
        if (platformEntry && platformEntry.source.scopeType === 'platform') {
          steps[0] = {
            scope: platform,
            value: platformEntry.value,
            effective: true,
            locked: platformEntry.locked,
            lockReason: platformEntry.lockReason,
          }
        }
        setChain(steps)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [client, namespace, key])

  if (!key || !namespace) return null

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)' }}>
        <p role="alert">Could not load this key definition.</p>
      </div>
    )
  }

  if (!definition) {
    return <div style={{ padding: 'var(--space-8)' }} data-loading aria-busy="true" />
  }

  return (
    <ConfigI18nProvider>
      <div style={{ padding: 'var(--space-8)' }}>
        <button type="button" onClick={() => navigate(-1)} style={{ marginBottom: 'var(--space-6)' }}>
          ← Key catalog
        </button>
        <h1 style={{ margin: '0 0 var(--space-6)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)' }}>{definition.key}</h1>
        <KeyDefinitionDetail
          definition={definition}
          chain={chain}
          nameOf={(scope: Scope) => (scope.scopeType === 'platform' ? 'FuzeFront' : scope.scopeId ?? scope.scopeType)}
          onViewHistory={() => navigate(`/admin/config/keys/${encodeURIComponent(key)}/history?ns=${encodeURIComponent(namespace)}`)}
        />
      </div>
    </ConfigI18nProvider>
  )
}

export default ConfigKeyDefinitionPage
