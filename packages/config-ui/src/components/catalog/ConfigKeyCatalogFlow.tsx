import { Alert, Badge, SearchField, DataTable } from '@fuzefront/design-system'
import type { KeyDefinition, Paged } from '@fuzefront/config-client'
import { useConfigI18n } from '../../i18n/ConfigI18nProvider'

export type CatalogFilter = 'all' | 'system' | 'hidden' | 'secret' | 'deprecated'

export interface ConfigKeyCatalogFlowProps {
  namespace: string
  /** `null` while loading. */
  page: Paged<KeyDefinition> | null
  loading?: boolean
  error?: string | null
  /** 403 — this reader lacks the platform-admin grant. The whole surface is fail-closed. */
  forbidden?: boolean
  /** No namespace has been registered at all yet (a first-run/setup state, distinct from an empty catalog). */
  noNamespaces?: boolean
  search: string
  filter: CatalogFilter
  onSearchChange: (search: string) => void
  onFilterChange: (filter: CatalogFilter) => void
  onRetry?: () => void
  onOpenDefinition: (key: string) => void
  /** Fetch the next page with this `nextCursor`. Omit/absent `hasNextPage` hides the control. */
  onLoadMore?: (cursor: string) => void
  /** Undo the last `onLoadMore` — the host keeps its own cursor stack; this only asks to go back one page. */
  onLoadPrevious?: () => void
  hasPrevious?: boolean
}

const FLAG_STYLE = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' } as const

/**
 * `ConfigKeyCatalogFlow` — `/admin/config/catalog`, flow `key-catalog`
 * (frames 05, 07). Read-only, platform-admin-only, and the ONLY surface that
 * ever renders `isHidden` key definitions — see `03-editor-states.html`
 * hidden-absent, which the settings editor commissions the opposite
 * guarantee for.
 */
export function ConfigKeyCatalogFlow({
  namespace,
  page,
  loading = false,
  error = null,
  forbidden = false,
  noNamespaces = false,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onRetry,
  onOpenDefinition,
  onLoadMore,
  onLoadPrevious,
  hasPrevious = false,
}: ConfigKeyCatalogFlowProps) {
  const { messages } = useConfigI18n()
  const m = messages.catalog

  if (forbidden) {
    return (
      <div data-state="forbidden">
        <Alert tone="error" title={m.forbiddenTitle}>{m.forbiddenBody}</Alert>
      </div>
    )
  }

  if (noNamespaces) {
    return (
      <div data-state="empty-namespaces">
        <h3>{m.emptyNamespacesTitle}</h3>
        <p style={{ color: 'var(--text-tertiary)' }}>{m.emptyNamespacesBody}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div data-state="load-error">
        <Alert tone="error" title={m.loadErrorTitle} data-error-code="LOAD_FAILED">{error}</Alert>
        <button type="button" data-action="retry" onClick={onRetry} style={{ marginTop: 'var(--space-3)' }}>
          {messages.common.retry}
        </button>
      </div>
    )
  }

  const items = page?.items ?? []
  const noResults = !loading && page !== null && items.length === 0 && (Boolean(search) || filter !== 'all')
  const emptyKeys = !loading && page !== null && items.length === 0 && !search && filter === 'all'

  const columns = [
    { key: 'key', header: m.columnKey },
    { key: 'type', header: m.columnType },
    { key: 'scopes', header: m.columnSettableAt },
    { key: 'flags', header: m.columnFlags },
    { key: 'default', header: m.columnDefault },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', padding: 'var(--space-4) 0' }}>
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <SearchField placeholder={m.searchPlaceholder} value={search} onChange={e => onSearchChange(e.target.value)} data-catalog-search />
        </div>
        {(['all', 'system', 'hidden', 'secret', 'deprecated'] as CatalogFilter[]).map(f => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-catalog-filter={f}
            onClick={() => onFilterChange(f)}
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-xs)',
              border: '1px solid',
              borderColor: filter === f ? 'var(--accent-color)' : 'var(--border-color)',
              background: filter === f ? 'var(--accent-soft)' : 'var(--bg-quaternary)',
              cursor: 'pointer',
            }}
          >
            {f === 'all' ? m.filterAll : f === 'system' ? m.filterSystem : f === 'hidden' ? m.filterHidden : f === 'secret' ? m.filterSecret : m.filterDeprecated}
          </button>
        ))}
      </div>

      {noResults ? (
        <div data-state="no-results">
          <h3>{m.noResultsTitle}</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>{m.noResultsBody.replace('{query}', search)}</p>
          <button
            type="button"
            data-action="clear-filters"
            onClick={() => {
              onSearchChange('')
              onFilterChange('all')
            }}
          >
            {m.clearFilters}
          </button>
        </div>
      ) : emptyKeys ? (
        <div data-state="empty-keys">
          <h3>{m.emptyKeysTitle}</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>{m.emptyKeysBody.replace('{namespace}', namespace)}</p>
        </div>
      ) : (
        <DataTable columns={columns} loading={loading} data-catalog-table>
          <tbody>
            {items.map(def => (
              <tr key={def.id} data-catalog-row={def.key} data-hidden-key={def.isHidden || undefined} data-deprecated={Boolean(def.deprecatedAt) || undefined}>
                <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                  <a
                    href="#"
                    data-open-definition={def.key}
                    onClick={e => {
                      e.preventDefault()
                      onOpenDefinition(def.key)
                    }}
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-2)', textDecoration: 'none' }}
                  >
                    {def.key}
                  </a>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{def.description}</div>
                </td>
                <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                  <Badge tone="neutral" mono size="sm">{def.valueType}</Badge>
                </td>
                <td style={{ padding: 'var(--space-4) var(--space-6)', ...FLAG_STYLE, color: 'var(--text-tertiary)' }}>
                  {def.allowedScopes.join(' · ')}
                </td>
                <td style={{ padding: 'var(--space-4) var(--space-6)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                    {def.isSystem && <Badge tone="info" mono size="sm">system</Badge>}
                    {def.isSecret && <Badge tone="warning" mono size="sm">secret</Badge>}
                    {def.isHidden && <Badge tone="error" mono size="sm" data-hidden-key="true">hidden</Badge>}
                    {def.isReadonly && <Badge tone="neutral" mono size="sm">readonly</Badge>}
                    {def.requiresRestart && <Badge tone="info" mono size="sm">restart</Badge>}
                    {def.deprecatedAt && <Badge tone="error" mono size="sm">deprecated</Badge>}
                  </div>
                </td>
                <td style={{ padding: 'var(--space-4) var(--space-6)', fontFamily: 'var(--font-mono)' }}>
                  {def.isSecret ? <span style={{ color: 'var(--text-tertiary)' }}>{m.secretDefault}</span> : String(def.defaultValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {!noResults && !emptyKeys && page && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-4) 0' }}>
          <button type="button" disabled={!hasPrevious} aria-disabled={!hasPrevious || undefined} onClick={onLoadPrevious} data-action="catalog-previous">
            {m.previous}
          </button>
          <button
            type="button"
            disabled={!page.pageInfo.hasNextPage}
            aria-disabled={!page.pageInfo.hasNextPage || undefined}
            onClick={() => page.pageInfo.nextCursor && onLoadMore?.(page.pageInfo.nextCursor)}
            data-action="catalog-next"
          >
            {m.next}
          </button>
        </div>
      )}
    </div>
  )
}
