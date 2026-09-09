import type { AuthState } from '../hooks'

export function MyAccessPage({ auth }: { auth: AuthState }) {
  if (auth.loading) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-secondary-500">Loading…</div>
  }

  if (!auth.signedIn || !auth.access) {
    return <div className="mx-auto max-w-3xl px-4 py-10 text-secondary-500">Sign in to see your access status.</div>
  }

  const { access } = auth

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-secondary-900">My access</h1>

      <div className="mt-6 rounded-lg border border-secondary-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-secondary-500">Signed in as</dt>
          <dd className="text-secondary-900">{access.email ?? access.userId}</dd>

          <dt className="text-secondary-500">Root org developer status</dt>
          <dd>
            {access.developer ? (
              <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">Confirmed</span>
            ) : (
              <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700">Not confirmed</span>
            )}
          </dd>

          <dt className="text-secondary-500">Sandbox quota (this hour)</dt>
          <dd className="text-secondary-900">
            {access.quota.used} / {access.quota.limit}
          </dd>
        </dl>
      </div>

      {!access.developer && (
        <p className="mt-4 text-sm text-secondary-500">
          Your developer role hasn't been confirmed yet — this can take a moment after your first
          sign-in. If it doesn't resolve, sign out and back in.
        </p>
      )}
    </div>
  )
}
