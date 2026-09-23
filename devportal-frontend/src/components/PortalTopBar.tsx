import { Link, NavLink } from 'react-router-dom'
import { Avatar, Button, StatusPill } from '@fuzefront/design-system'
import { signInUrl, api } from '../services/api'
import type { UseMyAccess } from '../hooks'

/** PortalTopBar — present on every route. Carries the flow-independent
 * data-auth contract (frame 01/02 acceptanceNotes): 'anonymous' | 'authenticated'. */
export function PortalTopBar({ auth }: { auth: UseMyAccess }) {
  const authenticated = auth.state.kind === 'active' || auth.state.kind === 'provisioning'

  return (
    <header className="dp-topbar">
      <div
        className="dp-topbar-inner"
        data-panel="portal-topbar"
        data-auth={authenticated ? 'authenticated' : 'anonymous'}
      >
        <Link to="/" className="dp-brand">
          <span className="dp-brand-mark" aria-hidden="true" />
          FuzeFront Developers
        </Link>

        <nav className="dp-nav" aria-label="Primary">
          <NavLink to="/" end className="dp-nav-link">Home</NavLink>
          <NavLink to="/catalog" className="dp-nav-link">Catalog</NavLink>
          <NavLink to="/playground" className="dp-nav-link">Playground</NavLink>
          <NavLink to="/access" className="dp-nav-link">My access</NavLink>
        </nav>

        <div className="dp-topbar-actions">
          {auth.state.kind === 'active' && (
            <StatusPill status="active" label="Active" data-membership-status="active" />
          )}
          {/* Provisioning has NO data-membership-status badge here (only /access's own
           * MembershipPanel-equivalent StatusCallout carries it) — my-access.red.spec.ts's
           * provisioning test asserts a SINGLE, unscoped `[data-membership-status='provisioning']`
           * match, and this topbar is mounted on every route including /access itself. */}
          {auth.state.kind === 'provisioning' && (
            <StatusPill status="pending" label="Provisioning" />
          )}
          {authenticated ? (
            <div className="dp-row">
              <Avatar
                size="sm"
                interactive
                email={auth.access?.email ?? undefined}
                name={auth.access?.email ?? undefined}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => api.logout().finally(auth.refresh)}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" data-action="sign-in" onClick={() => { window.location.href = signInUrl() }}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
