/**
 * DevPortalHomeFlow — route `/` (design/frames/devportal 01-home-signed-out,
 * 02-home-signed-in). Renders the anonymous landing (hero, quick links with
 * Playground/My access/the product directory locked, the sandbox-only
 * promise) or the personalized signed-in home (quota strip, recent specs,
 * sandbox activity, the product directory — each with its own onboarding-
 * empty variant for a developer's very first sign-in).
 *
 * The product directory is sign-in-gated (2026-09-16, direct owner
 * direction — see home.red.spec.ts's signed-out product-directory test):
 * it previously rendered unconditionally, disclosing the full family
 * product list to anonymous visitors. Deliberately makes NO GET /v1/catalog
 * call even when authenticated: the product directory is the static list in
 * ../../data/productDirectory.ts, not a live fetch — see that file's header.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, Skeleton } from '@fuzefront/design-system'
import { SafetyNotice } from '../../components/SafetyNotice'
import { QuotaMeter } from '../../components/QuotaMeter'
import { MethodBadge } from '../../components/ds/MethodBadge'
import { PRODUCT_DIRECTORY } from '../../data/productDirectory'
import { OPERATION_INDEX } from '../../data/operationIndex'
import { api, signInUrl, type PlaygroundCall, type Quota } from '../../services/api'
import type { UseMyAccess } from '../../hooks'

function describeCall(call: PlaygroundCall): string {
  const known = OPERATION_INDEX[call.operation_id]
  if (known) return `${known.repo}/${known.service}`
  const segments = call.path.split('/').filter(Boolean)
  const service = segments[segments.length - 1] || call.operation_id
  return `fuzefront/${service}`
}

function recentSpecLabels(history: PlaygroundCall[]): string[] {
  const seen = new Set<string>()
  for (const call of history) seen.add(describeCall(call))
  return Array.from(seen)
}

export function DevPortalHomeFlow({ auth }: { auth: UseMyAccess }) {
  const authenticated = auth.state.kind === 'active'
  const [quota, setQuota] = useState<Quota | null>(null)
  const [history, setHistory] = useState<PlaygroundCall[] | null>(null)

  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    api.getQuota().then(q => { if (!cancelled) setQuota(q) }).catch(() => {})
    api.getHistory().then(({ items }) => { if (!cancelled) setHistory(items) }).catch(() => {})
    return () => { cancelled = true }
  }, [authenticated])

  return (
    <div className="dp-stack">
      <HomeHero authenticated={authenticated} />
      <QuickLinkGrid authenticated={authenticated} />

      {authenticated &&
        (quota ? (
          <QuotaMeter quota={quota} panel="quota-summary" label="Sandbox calls this window" />
        ) : (
          <section data-panel="quota-summary">
            <Skeleton height="2rem" />
          </section>
        ))}

      {authenticated && (
        <div className="dp-grid-2">
          <RecentSpecsPanel history={history} />
          <SandboxActivityPanel history={history} />
        </div>
      )}

      {authenticated && <ProductDirectory />}
      <SafetyNotice />
    </div>
  )
}

function HomeHero({ authenticated }: { authenticated: boolean }) {
  const navigate = useNavigate()
  return (
    <section className="dp-hero" data-panel="home-hero">
      <h1 className="dp-hero-title">One catalog for every API across the Fuze family</h1>
      <p className="dp-hero-body">
        Browse the OpenAPI docs for each product, and try an endpoint safely in a sandbox that
        never touches production.
      </p>
      <div className="dp-row">
        {!authenticated && (
          <Button variant="primary" data-action="sign-in" href={signInUrl()}>
            Sign in to explore
          </Button>
        )}
        <Button variant="secondary" data-action="browse-catalog" onClick={() => navigate('/catalog')}>
          Browse the catalog
        </Button>
      </div>
    </section>
  )
}

function QuickLinkGrid({ authenticated }: { authenticated: boolean }) {
  return (
    <div className="dp-grid" data-panel="quick-links">
      <QuickLink
        id="catalog"
        to="/catalog"
        title="Browse the catalog"
        body="Every OpenAPI spec harvested from the Fuze family."
        locked={false}
      />
      <QuickLink
        id="playground"
        to="/playground"
        title="Try it in the playground"
        body="Exercise any operation safely — sandboxed, never production."
        locked={!authenticated}
      />
      <QuickLink
        id="my-access"
        to="/access"
        title="My access"
        body="Your membership, sandbox quota and sandbox keys."
        locked={!authenticated}
      />
    </div>
  )
}

function QuickLink({ id, to, title, body, locked }: { id: string; to: string; title: string; body: string; locked: boolean }) {
  const navigate = useNavigate()
  if (locked) {
    return (
      <div className="dp-quick-link" data-quick-link={id} data-locked="true" aria-disabled="true">
        <span className="dp-quick-link-title">{title}</span>
        <p className="dp-quick-link-body">{body} Sign in to unlock.</p>
      </div>
    )
  }
  return (
    <button
      type="button"
      className="dp-quick-link"
      data-quick-link={id}
      onClick={() => navigate(to)}
    >
      <span className="dp-quick-link-title">{title}</span>
      <p className="dp-quick-link-body">{body}</p>
    </button>
  )
}

function ProductDirectory() {
  return (
    <section className="dp-panel" data-panel="product-directory">
      <h2>Participating products</h2>
      <div className="dp-grid" style={{ marginTop: 'var(--space-4)' }}>
        {PRODUCT_DIRECTORY.map(product => (
          <div key={product.id} className="dp-product-card" data-product={product.id}>
            <span className="dp-product-name">{product.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function RecentSpecsPanel({ history }: { history: PlaygroundCall[] | null }) {
  const navigate = useNavigate()
  return (
    <section className="dp-panel" data-panel="recent-specs">
      <h2>Your recent specs</h2>
      {history === null ? (
        <Skeleton height="4rem" aria-busy="true" />
      ) : history.length === 0 ? (
        <EmptyState
          data-empty="no-recent-specs"
          title="No specs viewed yet"
          body="Browse the catalog to find an API and start exploring its docs."
          action={
            <Button size="sm" data-action="browse-catalog" onClick={() => navigate('/catalog')}>
              Browse the catalog
            </Button>
          }
        />
      ) : (
        <ul className="dp-stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {recentSpecLabels(history).map(label => (
            <li key={label} data-recent-spec={label} className="dp-row-between">
              <span className="mono">{label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SandboxActivityPanel({ history }: { history: PlaygroundCall[] | null }) {
  const navigate = useNavigate()
  return (
    <section className="dp-panel" data-panel="sandbox-activity">
      <h2>Your sandbox activity</h2>
      {history === null ? (
        <Skeleton height="4rem" aria-busy="true" />
      ) : history.length === 0 ? (
        <EmptyState
          data-empty="no-sandbox-activity"
          title="No sandbox calls yet"
          body="Open the playground and try an operation — it's always safe, never production."
          action={
            <Button size="sm" data-action="open-playground" onClick={() => navigate('/playground')}>
              Open the playground
            </Button>
          }
        />
      ) : (
        <ul className="dp-stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.map(call => (
            <li key={call.id} className="dp-row-between">
              <span className="dp-row">
                <MethodBadge method={call.method} />
                <span className="mono">{call.path}</span>
              </span>
              <span className="mono">{call.response_status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
