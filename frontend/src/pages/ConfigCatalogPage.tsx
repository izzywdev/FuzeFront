import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ConfigKeyCatalogFlow, ConfigI18nProvider, type CatalogFilter } from '@fuzefront/config-ui'
import { ConfigClient, isConfigApiError } from '@fuzefront/config-client'
import type { KeyDefinition, Namespace, Paged } from '@fuzefront/config-client'
import { getActiveAuthToken } from '../lib/accounts'

const CONFIG_API_BASE = '/api/config'
const PAGE_SIZE = 25

/**
 * `/admin/config/catalog` (flag `fuzefront.config.key-catalog`) — the
 * platform-admin key catalog, FF-EPIC-19-S4 (flow `key-catalog`, frames 05/07).
 * The ONLY surface that ever renders `isHidden` key definitions — reached via
 * `includeHidden: true`, which the service refuses with 403 for any caller
 * who isn't a platform admin (see `ConfigKeyCatalogFlow`'s `forbidden` state).
 */
function ConfigCatalogPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const namespace = searchParams.get('ns')

  const client = useRef(new ConfigClient({ baseUrl: CONFIG_API_BASE, token: () => getActiveAuthToken() ?? undefined })).current

  const [namespaces, setNamespaces] = useState<Namespace[] | null>(null)
  const [page, setPage] = useState<Paged<KeyDefinition> | null>(null)
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CatalogFilter>('all')

  useEffect(() => {
    let cancelled = false
    client
      .listNamespaces({ limit: 50 })
      .then(res => {
        if (cancelled) return
        setNamespaces(res.items)
        if (!namespace && res.items.length > 0) {
          setSearchParams(prev => {
            const next = new URLSearchParams(prev)
            next.set('ns', res.items[0].namespace)
            return next
          })
        }
      })
      .catch(() => {
        if (!cancelled) setNamespaces([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(
    async (cursor?: string) => {
      if (!namespace) return
      setLoading(true)
      setError(null)
      setForbidden(false)
      try {
        const result = await client.listKeyDefinitions(namespace, {
          cursor,
          limit: PAGE_SIZE,
          search: search || undefined,
          category: undefined,
          includeHidden: true,
        })
        setPage(result)
      } catch (err) {
        if (isConfigApiError(err) && err.code === 'FORBIDDEN') {
          setForbidden(true)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
        setPage(null)
      } finally {
        setLoading(false)
      }
    },
    [client, namespace, search]
  )

  useEffect(() => {
    setCursorStack([undefined])
    if (namespace) void load(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, search])

  const filterEntries = (items: KeyDefinition[]): KeyDefinition[] => {
    if (filter === 'all') return items
    return items.filter(d => {
      if (filter === 'system') return d.isSystem
      if (filter === 'hidden') return d.isHidden
      if (filter === 'secret') return d.isSecret
      if (filter === 'deprecated') return Boolean(d.deprecatedAt)
      return true
    })
  }

  const filteredPage = page ? { ...page, items: filterEntries(page.items) } : null

  if (!namespaces) {
    return <div style={{ padding: 'var(--space-8)' }} data-loading aria-busy="true" />
  }

  return (
    <ConfigI18nProvider>
      <div style={{ padding: 'var(--space-8)' }}>
        <h1 style={{ margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)' }}>
          Key catalog
        </h1>
        <ConfigKeyCatalogFlow
          namespace={namespace ?? ''}
          page={filteredPage}
          loading={loading}
          error={error}
          forbidden={forbidden}
          noNamespaces={namespaces.length === 0}
          search={search}
          filter={filter}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onRetry={() => void load(cursorStack[cursorStack.length - 1])}
          onOpenDefinition={key => navigate(`/admin/config/catalog/${encodeURIComponent(key)}?ns=${encodeURIComponent(namespace ?? '')}`)}
          hasPrevious={cursorStack.length > 1}
          onLoadPrevious={() => {
            const next = cursorStack.slice(0, -1)
            setCursorStack(next)
            void load(next[next.length - 1])
          }}
          onLoadMore={cursor => {
            setCursorStack(prev => [...prev, cursor])
            void load(cursor)
          }}
        />
      </div>
    </ConfigI18nProvider>
  )
}

export default ConfigCatalogPage
