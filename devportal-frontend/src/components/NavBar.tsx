import { Link, NavLink } from 'react-router-dom'
import { signInUrl, api } from '../services/api'
import type { AuthState } from '../hooks'

export function NavBar({ auth, onSignedOut }: { auth: AuthState; onSignedOut: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700' : 'text-secondary-700 hover:bg-secondary-50'}`

  return (
    <nav className="border-b border-secondary-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="text-lg font-semibold text-secondary-900">
          FuzeFront Developers
        </Link>
        <div className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>Home</NavLink>
          <NavLink to="/catalog" className={linkClass}>Catalog</NavLink>
          <NavLink to="/playground" className={linkClass}>Playground</NavLink>
          {auth.signedIn && <NavLink to="/my-access" className={linkClass}>My access</NavLink>}
          {auth.signedIn ? (
            <button
              className="ml-2 rounded-md border border-secondary-300 px-3 py-2 text-sm font-medium text-secondary-700 hover:bg-secondary-50"
              onClick={() => api.logout().finally(onSignedOut)}
            >
              Sign out{auth.access?.email ? ` (${auth.access.email})` : ''}
            </button>
          ) : (
            <a
              href={signInUrl()}
              className="ml-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </nav>
  )
}
