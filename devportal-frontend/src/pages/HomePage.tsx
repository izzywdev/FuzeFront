import { Link } from 'react-router-dom'
import { signInUrl } from '../services/api'
import type { AuthState } from '../hooks'

export function HomePage({ auth }: { auth: AuthState }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-semibold text-secondary-900">FuzeFront Developers</h1>
      <p className="mt-4 max-w-2xl text-lg text-secondary-600">
        One catalog for every API across the Fuze family — browse the OpenAPI docs for each
        product, and try an endpoint safely in a sandbox that never touches production.
      </p>

      {auth.loading ? null : auth.signedIn ? (
        <div className="mt-8 rounded-lg border border-secondary-200 bg-white p-6">
          <h2 className="text-lg font-medium text-secondary-900">Welcome back{auth.access?.email ? `, ${auth.access.email}` : ''}</h2>
          <p className="mt-1 text-sm text-secondary-600">
            You've made {auth.access?.quota.used ?? 0} of {auth.access?.quota.limit ?? 0} sandbox calls this hour.
          </p>
          <div className="mt-4 flex gap-3">
            <Link to="/catalog" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
              Browse the catalog
            </Link>
            <Link to="/my-access" className="rounded-md border border-secondary-300 px-4 py-2 text-sm font-medium text-secondary-700 hover:bg-secondary-50">
              My access
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex gap-3">
          <a href={signInUrl()} className="rounded-md bg-primary-600 px-5 py-3 text-sm font-medium text-white hover:bg-primary-700">
            Sign in to explore
          </a>
          <Link to="/catalog" className="rounded-md border border-secondary-300 px-5 py-3 text-sm font-medium text-secondary-700 hover:bg-secondary-50">
            Browse without signing in
          </Link>
        </div>
      )}

      <div className="mt-16 grid gap-6 sm:grid-cols-3">
        <Feature title="Aggregated catalog" body="Every service's openapi.yaml across the family, indexed and searchable in one place." />
        <Feature title="Same identity" body="Signs in with your existing FuzeFront account — no separate credential to manage." />
        <Feature title="Safe sandbox" body="Try any endpoint against its own documented examples. Never a real production system." />
      </div>
    </div>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-secondary-200 p-5">
      <h3 className="font-medium text-secondary-900">{title}</h3>
      <p className="mt-2 text-sm text-secondary-600">{body}</p>
    </div>
  )
}
