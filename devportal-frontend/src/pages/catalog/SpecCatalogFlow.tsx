/**
 * SpecCatalogFlow — route `/catalog` (design/frames/devportal 03-catalog,
 * 04-catalog-states). GET /v1/catalog returns the full lightweight entry list
 * with NO server-side filtering (services/devportal-service/openapi.yaml's
 * `/v1/catalog` takes no query parameters) — search/product/tag/sandbox-mode
 * filtering and the product->service tree are all derived client-side from
 * that one fetch.
 *
 * BACKEND GAP (flagged, not fixed here — out of this PR's UI-only scope):
 * `CatalogEntry` has no `sandboxMode`/`harvestValid` field, so `sandboxModeOf`
 * below is a best-effort client-side proxy (an entry whose `description`
 * mentions a failed harvest/validation reads as 'unavailable'; every other
 * entry reads as 'mock' — services/devportal-service's own `TryResponse`
 * schema documents `target` as "Always mock in this MVP", so 'sandbox' isn't
 * reachable data yet either, though the filter still offers it for forward
 * compatibility with the frame). A real `sandboxMode` field on `CatalogEntry`
 * would let this drop the heuristic entirely.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, EmptyState, ExternalLink, SearchField, Select, Skeleton, StatusCallout } from '@fuzefront/design-system'
import { TreeNav, type TreeNode } from '../../components/ds/TreeNav'
import { api, ApiError, type CatalogEntry } from '../../services/api'

type SandboxMode = 'mock' | 'sandbox' | 'unavailable'

function sandboxModeOf(entry: CatalogEntry): SandboxMode {
  return /harvest failed|failed validation/i.test(entry.description) ? 'unavailable' : 'mock'
}

function specId(entry: CatalogEntry): string {
  return `${entry.repo}/${entry.service}`
}

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: CatalogEntry[] }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

export function SpecCatalogFlow() {
  const navigate = useNavigate()
  const [state, setState] = useState<CatalogState>({ kind: 'loading' })
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sandboxFilter, setSandboxFilter] = useState('')
  const [selectedTreeNode, setSelectedTreeNode] = useState<string | undefined>(undefined)

  function load() {
    setState({ kind: 'loading' })
    api
      .listCatalog()
      .then(({ items }) => setState({ kind: 'ready', items }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          setState({ kind: 'forbidden' })
        } else {
          setState({ kind: 'error', message: err instanceof Error ? err.message : 'The catalog harvest failed.' })
        }
      })
  }

  useEffect(load, [])

  function clearFilters() {
    setSearch('')
    setProductFilter('')
    setTagFilter('')
    setSandboxFilter('')
    setSelectedTreeNode(undefined)
  }

  const items = useMemo(() => (state.kind === 'ready' ? state.items : []), [state])

  const tree: TreeNode[] = useMemo(() => {
    const byRepo = new Map<string, CatalogEntry[]>()
    for (const entry of items) {
      const list = byRepo.get(entry.repo) ?? []
      list.push(entry)
      byRepo.set(entry.repo, list)
    }
    return Array.from(byRepo.entries()).map(([repo, entries]) => ({
      id: repo,
      label: repo,
      children: entries.map(e => ({ id: specId(e), label: e.service })),
    }))
  }, [items])

  const products = useMemo(() => Array.from(new Set(items.map(e => e.repo))).sort(), [items])
  const tags = useMemo(() => Array.from(new Set(items.flatMap(e => e.tags))).sort(), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(entry => {
      if (productFilter && entry.repo !== productFilter) return false
      if (tagFilter && !entry.tags.includes(tagFilter)) return false
      if (sandboxFilter && sandboxModeOf(entry) !== sandboxFilter) return false
      if (selectedTreeNode) {
        const matchesRepo = selectedTreeNode === entry.repo
        const matchesSpec = selectedTreeNode === specId(entry)
        if (!matchesRepo && !matchesSpec) return false
      }
      if (!q) return true
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.service.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.tags.some(t => t.toLowerCase().includes(q))
      )
    })
  }, [items, search, productFilter, tagFilter, sandboxFilter, selectedTreeNode])

  if (state.kind === 'forbidden') {
    return (
      <div className="dp-stack" data-state="forbidden">
        <StatusCallout tone="error" title="Developer access required" data-http="403" data-error="not-a-developer">
          Your account doesn't have the Developer role on the platform root organization yet.
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button size="sm" data-action="view-my-access" onClick={() => navigate('/access')}>
              View my access
            </Button>
          </div>
        </StatusCallout>
      </div>
    )
  }

  return (
    <div className="dp-catalog-layout">
      <aside className="dp-panel dp-panel-tight" data-panel="catalog-tree" aria-label="Product and service tree">
        {state.kind === 'loading' ? (
          <Skeleton height="12rem" />
        ) : (
          <TreeNav nodes={tree} selectedId={selectedTreeNode} onSelect={id => setSelectedTreeNode(prev => (prev === id ? undefined : id))} />
        )}
      </aside>

      <div className="dp-stack">
        <div className="dp-filters-row dp-panel dp-panel-tight" data-panel="catalog-filters">
          <div className="dp-filter-field">
            <SearchField
              data-input="catalog-search"
              label="Search the catalog"
              placeholder="Search by service, title or tag…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="dp-filter-field" data-filter="product">
            <Select
              label="Product"
              placeholder="All products"
              options={products.map(p => ({ value: p, label: p }))}
              value={productFilter}
              onChange={e => setProductFilter(e.target.value)}
            />
          </div>
          <div className="dp-filter-field" data-filter="tag">
            <Select
              label="Tag"
              placeholder="All tags"
              options={tags.map(t => ({ value: t, label: t }))}
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
            />
          </div>
          <div className="dp-filter-field" data-filter="sandbox-mode">
            <Select
              label="Sandbox mode"
              placeholder="Any sandbox mode"
              options={[
                { value: 'mock', label: 'Mock' },
                { value: 'sandbox', label: 'Sandbox' },
                { value: 'unavailable', label: 'Unavailable' },
              ]}
              value={sandboxFilter}
              onChange={e => setSandboxFilter(e.target.value)}
            />
          </div>
          <Button variant="ghost" size="sm" data-action="clear-filters" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>

        <section
          className="dp-result-list"
          data-panel="catalog-results"
          aria-busy={state.kind === 'loading'}
          data-state={
            state.kind === 'loading'
              ? 'loading'
              : state.kind === 'error'
                ? 'error'
                : items.length === 0
                  ? 'empty'
                  : filtered.length === 0
                    ? 'empty-filtered'
                    : undefined
          }
        >
          {state.kind === 'loading' && (
            <>
              <Skeleton height="4.5rem" />
              <Skeleton height="4.5rem" style={{ marginTop: 'var(--space-3)' }} />
              <Skeleton height="4.5rem" style={{ marginTop: 'var(--space-3)' }} />
            </>
          )}

          {state.kind === 'error' && (
            <StatusCallout tone="error" title="The catalog harvest failed" data-error="harvest-failed">
              {state.message} You're viewing a stale snapshot — some entries may be out of date.
              <div className="dp-row" style={{ marginTop: 'var(--space-3)' }}>
                <span
                  className="mono"
                  data-catalog="stale"
                  style={{ fontSize: 'var(--text-2xs)', color: 'var(--warning-color)' }}
                >
                  stale snapshot
                </span>
                <Button size="sm" variant="secondary" data-action="retry" onClick={load}>
                  Retry
                </Button>
              </div>
            </StatusCallout>
          )}

          {state.kind === 'ready' && items.length === 0 && (
            <EmptyState
              data-empty="no-specs"
              title="Nothing harvested yet"
              body="No OpenAPI specs have been published to the catalog yet. Publish yours by wiring the harvest CI job."
              action={
                <ExternalLink
                  variant="button"
                  data-action="view-publish-guide"
                  href="https://github.com/izzywdev/FuzeFront/blob/master/docs/planning/developers-portal.md"
                >
                  View the publish-spec guide
                </ExternalLink>
              }
            />
          )}

          {state.kind === 'ready' && items.length > 0 && filtered.length === 0 && (
            <EmptyState
              data-empty="no-results"
              title="No specs match your filters"
              body={`0 of ${items.length} specs match. Try a different search or clear your filters.`}
              action={
                <Button size="sm" data-action="clear-filters" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

          {state.kind === 'ready' &&
            filtered.map(entry => {
              const mode = sandboxModeOf(entry)
              return (
                <Link
                  key={entry.id}
                  to={`/catalog/${entry.repo}/${entry.service}`}
                  className="dp-result-card"
                  data-spec={specId(entry)}
                  data-spec-version={entry.version}
                  data-sandbox-mode={mode}
                  data-catalog={mode === 'unavailable' ? 'stale' : undefined}
                >
                  <div className="dp-row-between">
                    <span className="dp-quick-link-title">{entry.title}</span>
                    <span data-sandbox-mode={mode} className="mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                      {mode}
                    </span>
                  </div>
                  <p className="dp-quick-link-body">{entry.description}</p>
                  <div className="dp-row" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                    <span className="mono">v{entry.version}</span>
                    <span>·</span>
                    <span>{entry.tags.join(', ')}</span>
                    <span>·</span>
                    <span>harvested {new Date(entry.fetchedAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              )
            })}
        </section>

        {state.kind === 'ready' && (
          <div data-result-count={filtered.length} className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {filtered.length} of {items.length} specs
          </div>
        )}
      </div>
    </div>
  )
}
