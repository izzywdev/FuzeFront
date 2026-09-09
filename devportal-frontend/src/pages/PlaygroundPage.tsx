import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, type Quota, type TryResponse } from '../services/api'
import { signInUrl } from '../services/api'

export function PlaygroundPage() {
  const [params] = useSearchParams()
  const [specId, setSpecId] = useState(params.get('specId') ?? '')
  const [operationId, setOperationId] = useState(params.get('operationId') ?? '')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [result, setResult] = useState<TryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .getQuota()
      .then(setQuota)
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) setSignedOut(true)
      })
  }, [])

  async function handleTry() {
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      const res = await api.tryOperation(specId, operationId)
      setResult(res)
      const q = await api.getQuota()
      setQuota(q)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Sandbox call quota exceeded for this hour. Try again later.')
      } else if (err instanceof ApiError && err.status === 404) {
        setError('That spec or operation could not be found.')
      } else {
        setError(err instanceof Error ? err.message : 'The sandbox call failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (signedOut) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-secondary-900">Playground</h1>
        <div className="mt-6 rounded-lg border border-secondary-200 bg-white p-6">
          <p className="text-secondary-700">Sign in to use the sandbox playground.</p>
          <a href={signInUrl()} className="mt-3 inline-block rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            Sign in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-secondary-900">Playground</h1>
      <p className="mt-1 text-secondary-600">
        Try any operation safely — this always runs against the spec's own documented examples,
        never a real production system.
      </p>

      {quota && (
        <p className="mt-4 text-sm text-secondary-500">
          {quota.used} / {quota.limit} sandbox calls used this hour.
          {quota.used >= quota.limit && <span className="ml-2 font-medium text-warning-700">Quota exceeded.</span>}
        </p>
      )}

      <div className="mt-6 space-y-3 rounded-lg border border-secondary-200 bg-white p-5">
        <label className="block text-sm font-medium text-secondary-700">
          Spec ID
          <input
            value={specId}
            onChange={e => setSpecId(e.target.value)}
            placeholder="From a catalog entry's spec viewer"
            className="mt-1 w-full rounded-md border border-secondary-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm font-medium text-secondary-700">
          Operation ID
          <input
            value={operationId}
            onChange={e => setOperationId(e.target.value)}
            placeholder="e.g. listWidgets"
            className="mt-1 w-full rounded-md border border-secondary-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          disabled={!specId || !operationId || busy}
          onClick={handleTry}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? 'Running…' : 'Try it'}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-error-500 bg-error-50 p-4 text-error-700">{error}</div>}

      {result && (
        <div className="mt-4 rounded-lg border border-secondary-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm">{result.status}</span>
            <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">
              sandboxed — {result.source}
            </span>
          </div>
          <pre className="mt-3 overflow-x-auto rounded bg-secondary-900 p-4 text-xs text-white">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
