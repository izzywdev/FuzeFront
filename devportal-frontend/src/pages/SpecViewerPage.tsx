import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type SpecRecord } from '../services/api'

interface Operation {
  path: string
  method: string
  operationId: string
  summary?: string
  tags?: string[]
}

function extractOperations(spec: SpecRecord): Operation[] {
  const paths = (spec.rawSpec as any).paths ?? {}
  const ops: Operation[] = []
  for (const [path, methods] of Object.entries<any>(paths)) {
    for (const [method, operation] of Object.entries<any>(methods)) {
      if (!operation?.operationId) continue
      ops.push({ path, method: method.toUpperCase(), operationId: operation.operationId, summary: operation.summary, tags: operation.tags })
    }
  }
  return ops
}

export function SpecViewerPage() {
  const { repo, service } = useParams<{ repo: string; service: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'not-found' } | { status: 'error'; message: string } | { status: 'ready'; spec: SpecRecord }
  >({ status: 'loading' })

  useEffect(() => {
    if (!repo || !service) return
    api
      .getSpec(repo, service)
      .then(spec => setState({ status: 'ready', spec }))
      .catch(err => {
        if (err instanceof ApiError && err.status === 404) setState({ status: 'not-found' })
        else setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load the spec.' })
      })
  }, [repo, service])

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link to="/catalog" className="text-sm text-primary-600 hover:underline">&larr; Back to catalog</Link>

      {state.status === 'loading' && <p className="mt-6 text-secondary-500">Loading…</p>}
      {state.status === 'not-found' && <p className="mt-6 text-secondary-500">No spec harvested for {repo}/{service}.</p>}
      {state.status === 'error' && (
        <div className="mt-6 rounded-lg border border-error-500 bg-error-50 p-4 text-error-700">{state.message}</div>
      )}

      {state.status === 'ready' && (
        <>
          <h1 className="mt-4 text-2xl font-semibold text-secondary-900">
            {(state.spec.rawSpec as any).info?.title ?? state.spec.service}
          </h1>
          <p className="mt-1 text-sm text-secondary-500">v{state.spec.version} · {state.spec.specPath}</p>
          {(state.spec.rawSpec as any).info?.description && (
            <p className="mt-4 max-w-3xl text-secondary-700">{(state.spec.rawSpec as any).info.description}</p>
          )}

          <h2 className="mt-8 text-lg font-medium text-secondary-900">Operations</h2>
          <div className="mt-3 divide-y divide-secondary-200 rounded-lg border border-secondary-200 bg-white">
            {extractOperations(state.spec).map(op => (
              <div key={op.operationId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="mr-3 inline-block w-16 rounded bg-secondary-100 px-2 py-0.5 text-center text-xs font-mono text-secondary-700">
                    {op.method}
                  </span>
                  <span className="font-mono text-sm text-secondary-800">{op.path}</span>
                  {op.summary && <span className="ml-3 text-sm text-secondary-500">{op.summary}</span>}
                </div>
                <button
                  className="rounded-md border border-secondary-300 px-3 py-1 text-xs font-medium text-secondary-700 hover:bg-secondary-50"
                  onClick={() => navigate(`/playground?specId=${state.spec.id}&operationId=${op.operationId}`)}
                >
                  Try it
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
