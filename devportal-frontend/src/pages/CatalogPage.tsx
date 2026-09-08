import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type CatalogEntry } from '../services/api'
import { signInUrl } from '../services/api'

export function CatalogPage() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'signed-out' } | { status: 'error'; message: string } | { status: 'ready'; items: CatalogEntry[] }
  >({ status: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    api
      .listCatalog()
      .then(({ items }) => setState({ status: 'ready', items }))
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) {
          setState({ status: 'signed-out' })
        } else {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load the catalog.' })
        }
      })
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-secondary-900">Catalog</h1>
      <p className="mt-1 text-secondary-600">Every OpenAPI spec harvested from the Fuze family.</p>

      {state.status === 'ready' && (
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by service, title or tag…"
          className="mt-6 w-full max-w-md rounded-md border border-secondary-300 px-3 py-2 text-sm"
        />
      )}

      <div className="mt-6">
        {state.status === 'loading' && <p className="text-secondary-500">Loading…</p>}

        {state.status === 'signed-out' && (
          <div className="rounded-lg border border-secondary-200 bg-white p-6">
            <p className="text-secondary-700">Sign in to browse the catalog.</p>
            <a href={signInUrl()} className="mt-3 inline-block rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
              Sign in
            </a>
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded-lg border border-error-500 bg-error-50 p-4 text-error-700">
            Couldn't load the catalog: {state.message}
          </div>
        )}

        {state.status === 'ready' && state.items.length === 0 && (
          <p className="text-secondary-500">No specs have been harvested yet.</p>
        )}

        {state.status === 'ready' && state.items.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.items
              .filter(item => {
                const q = query.trim().toLowerCase()
                if (!q) return true
                return (
                  item.title.toLowerCase().includes(q) ||
                  item.service.toLowerCase().includes(q) ||
                  item.tags.some(t => t.toLowerCase().includes(q))
                )
              })
              .map(item => (
                <Link
                  key={item.id}
                  to={`/catalog/${item.repo}/${item.service}`}
                  className="rounded-lg border border-secondary-200 bg-white p-4 hover:border-primary-400 hover:shadow-soft"
                >
                  <div className="text-xs uppercase tracking-wide text-secondary-400">{item.repo}</div>
                  <div className="mt-1 font-medium text-secondary-900">{item.title}</div>
                  <div className="mt-1 text-xs text-secondary-500">v{item.version}</div>
                  {item.description && <p className="mt-2 line-clamp-2 text-sm text-secondary-600">{item.description}</p>}
                  {item.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {item.tags.slice(0, 4).map(tag => (
                        <span key={tag} className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
