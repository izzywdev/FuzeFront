import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfigSettingsEditorFlow, ConfigI18nProvider } from '@fuzefront/config-ui'
import { ConfigClient, isConfigApiError, isNotModified } from '@fuzefront/config-client'
import type { EffectiveConfigEntry, Namespace, Scope, ConfigWriteResult } from '@fuzefront/config-client'
import { getActiveAuthToken } from '../lib/accounts'
import { useCurrentUser, useOrganizations } from '../lib/shared'

/** Same-origin API base — never an absolute host (mixed-content under TLS the moment the environment changes). */
const CONFIG_API_BASE = '/api/config'

/**
 * `/config` (flag `fuzefront.config.management-console`) — the settings
 * editor, FF-EPIC-19-S3 (design/frames/config-management flow
 * `settings-editor`). Scoped to the caller's active organization (falling
 * back to the platform tier when no org is active — e.g. the Personal
 * context). `ConfigSettingsEditorFlow` is fully controlled; this page owns
 * every fetch/write against `@fuzefront/config-client`.
 *
 * Portal tier is intentionally OMITTED from the visible chain here: FF-EPIC-10's
 * `buildScopeChain` middleware resolves only `platform` + the exact scope
 * queried today, and this page has no reliable portal id to read independent
 * of that work landing. Widening to the full 4-tier chain is a follow-up once
 * that middleware ships — see `@fuzefront/config-ui`'s README.
 */
function ConfigPage() {
  const { user } = useCurrentUser()
  const { activeOrganization, activeOrganizationId } = useOrganizations()

  const activeScope: Scope = useMemo(
    () => (activeOrganizationId ? { scopeType: 'org', scopeId: activeOrganizationId } : { scopeType: 'platform' }),
    [activeOrganizationId]
  )

  const chain = useMemo(() => {
    const steps = [{ scope: { scopeType: 'platform' } as Scope, name: 'FuzeFront' }]
    if (activeOrganizationId) {
      steps.push({ scope: activeScope, name: activeOrganization?.name ?? activeOrganizationId })
    }
    if (user) {
      steps.push({
        scope: { scopeType: 'user', scopeId: user.id } as Scope,
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'You',
      })
    }
    return steps
  }, [activeOrganizationId, activeOrganization, activeScope, user])

  const nameOf = useCallback(
    (scope: Scope) => chain.find(s => s.scope.scopeType === scope.scopeType)?.name ?? scope.scopeId ?? scope.scopeType,
    [chain]
  )

  const client = useRef(new ConfigClient({ baseUrl: CONFIG_API_BASE, token: () => getActiveAuthToken() ?? undefined })).current

  const [namespaces, setNamespaces] = useState<Namespace[] | null>(null)
  const [namespace, setNamespace] = useState<string | null>(null)
  const [entries, setEntries] = useState<EffectiveConfigEntry[] | null>(null)
  const [version, setVersion] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    client
      .listNamespaces({ limit: 50 })
      .then(page => {
        if (cancelled) return
        setNamespaces(page.items)
        if (page.items.length > 0) setNamespace(prev => prev ?? page.items[0].namespace)
      })
      .catch(() => {
        if (!cancelled) setNamespaces([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (ns: string, scope: Scope) => {
      setLoading(true)
      setError(null)
      setForbidden(false)
      try {
        const result = await client.getEffectiveConfig(ns, scope)
        if (isNotModified(result)) return
        setEntries(result.entries)
        setVersion(result.version)
      } catch (err) {
        if (isConfigApiError(err) && err.code === 'FORBIDDEN') {
          setForbidden(true)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
        setEntries(null)
      } finally {
        setLoading(false)
      }
    },
    [client]
  )

  useEffect(() => {
    if (namespace) void load(namespace, activeScope)
  }, [namespace, activeScope, load])

  const reReadRef = useRef<() => Promise<{ entries: EffectiveConfigEntry[]; version: string }>>(async () => {
    const fresh = await client.getEffectiveConfig(namespace ?? '', activeScope)
    if (isNotModified(fresh)) throw new Error('unexpected 304 during conflict re-read')
    return { entries: fresh.entries, version: fresh.version }
  })
  reReadRef.current = async () => {
    const fresh = await client.getEffectiveConfig(namespace ?? '', activeScope)
    if (isNotModified(fresh)) throw new Error('unexpected 304 during conflict re-read')
    return { entries: fresh.entries, version: fresh.version }
  }

  if (!namespace) {
    return <div style={{ padding: 'var(--space-8)' }} data-loading aria-busy="true" />
  }

  return (
    <ConfigI18nProvider>
      <div style={{ padding: 'var(--space-8)' }}>
        <h1
          style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)' }}
        >
          Configuration
        </h1>
        <ConfigSettingsEditorFlow
          chain={chain}
          activeScope={activeScope}
          namespace={namespace}
          version={version}
          entries={entries}
          loading={loading}
          error={error}
          forbidden={forbidden}
          nameOf={nameOf}
          // Reveal has no shipped endpoint yet (FF-EPIC-18-S1) — omit both
          // canReveal and onReveal so SecretField never offers the action.
          // Ancestor-value resolution for "pin the parent's value" likewise
          // has no dedicated endpoint; a future increment can wire it via an
          // extra getEffectiveConfig read at the parent scope.
          onScopeSelect={undefined}
          onNamespaceSwitch={
            namespaces && namespaces.length > 1
              ? () => {
                  const idx = namespaces.findIndex(n => n.namespace === namespace)
                  const next = namespaces[(idx + 1) % namespaces.length]
                  setNamespace(next.namespace)
                }
              : undefined
          }
          onRetry={() => void load(namespace, activeScope)}
          onSubmit={async input => client.writeConfigValues({ namespace, scope: activeScope, ...input })}
          onSaved={(result: ConfigWriteResult) => void load(namespace, activeScope).then(() => result)}
          onReRead={() => reReadRef.current()}
          onSecretWrite={async (key, op, value) => {
            await client.writeConfigValues({ namespace, scope: activeScope, operations: [{ key, op, value }] })
            await load(namespace, activeScope)
          }}
        />
      </div>
    </ConfigI18nProvider>
  )
}

export default ConfigPage
