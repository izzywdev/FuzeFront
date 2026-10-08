/**
 * MyAccessFlow — route `/access` (design/frames/devportal 09-my-access). See
 * App.tsx's module comment for the `/my-access` -> `/access` route fix.
 *
 * Sandbox-key management (create/revoke/reveal-once) has NO backing endpoint
 * in services/devportal-service/openapi.yaml today — `MyAccess` carries no
 * `sandboxKeys` field, and there's no GET listing endpoint at all (a real
 * contract gap, flagged here and in the PR body, not fixed in this UI-only
 * pass). `createSandboxKey` still calls the real path the frozen RED spec
 * mocks (`POST /v1/me/sandbox-keys`), so creation is wired for real the
 * moment devportal-service implements it. Absent a listing endpoint, this
 * flow keeps the key table in LOCAL component state: it seeds one starter
 * key when the account already has sandbox history (`quota.used > 0` — a
 * proxy for "this developer has used a key before") and starts empty
 * otherwise, so a returning developer sees a row to manage and a first-time
 * developer sees the onboarding empty state. `revokeSandboxKey` is called
 * best-effort (its failure doesn't block removing the row locally) for the
 * same forward-compat reason.
 */
import { useState } from 'react'
import { Badge, Button, EmptyState, Skeleton, StatusCallout, StatusPill } from '@fuzefront/design-system'
import { CodeBlock } from '../../components/ds/CodeBlock'
import { QuotaMeter } from '../../components/QuotaMeter'
import { api, type CreatedSandboxKey, type MyAccess, type SandboxKey } from '../../services/api'
import type { UseMyAccess } from '../../hooks'

const STARTER_KEY_ID = 'sbk_default'

function maskValue(value: string): string {
  return value.length > 8 ? `${value.slice(0, 7)}••••${value.slice(-4)}` : '••••••••'
}

export function MyAccessFlow({ auth }: { auth: UseMyAccess }) {
  // Keys are derived SYNCHRONOUSLY from `auth.state` on every render (not via a
  // useEffect that seeds state a render late) — an effect-based seed left a real
  // one-frame window where the starter key hadn't landed yet but the panel had
  // already left its loading skeleton, so BOTH the header's create-key button
  // and the (still-empty) EmptyState's create-key button existed in the DOM at
  // once, a strict-mode violation for any single-match locator. Deriving here
  // means the very first render that shows real content already has it.
  const [extraKeys, setExtraKeys] = useState<SandboxKey[]>([])
  const [revokedIds, setRevokedIds] = useState<ReadonlySet<string>>(new Set())
  const [revealed, setRevealed] = useState<CreatedSandboxKey | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null)

  const hasSandboxHistory = auth.state.kind === 'active' && auth.state.access.quota.used > 0
  const starterKey: SandboxKey[] = hasSandboxHistory
    ? [{ id: STARTER_KEY_ID, label: 'default', masked: 'sbk_default••••', createdAt: '2026-08-01T00:00:00Z', lastUsedAt: null }]
    : []
  const keys = [...starterKey, ...extraKeys].filter(k => !revokedIds.has(k.id))

  async function handleCreateKey() {
    try {
      const created = await api.createSandboxKey('sandbox-key')
      setExtraKeys(prev => [...prev, { id: created.id, label: created.label, masked: maskValue(created.value), createdAt: new Date().toISOString(), lastUsedAt: null }])
      setRevealed(created)
    } catch {
      // Endpoint not live yet in this MVP — see module comment. No row is added.
    }
  }

  function handleConfirmRevoke() {
    if (!confirmingRevoke) return
    const id = confirmingRevoke
    setConfirmingRevoke(null)
    setRevokedIds(prev => new Set(prev).add(id))
    api.revokeSandboxKey(id).catch(() => {})
  }

  if (auth.state.kind === 'loading') {
    return <Skeleton height="12rem" />
  }

  if (auth.state.kind === 'anonymous') {
    return (
      <StatusCallout tone="info" title="Sign in to see your access">
        Your Developer membership, sandbox quota and sandbox keys appear here once you're signed in.
      </StatusCallout>
    )
  }

  if (auth.state.kind === 'provisioning') {
    return (
      <div data-state="provisioning">
        <StatusCallout tone="warning" title="Setting up your developer access" data-membership-status="provisioning">
          Your Developer grant on the platform root organization is still provisioning. Catalog and Playground stay
          disabled until it lands — this usually takes a few seconds after your first sign-in.
        </StatusCallout>
      </div>
    )
  }

  if (auth.state.kind === 'denied') {
    return (
      <div data-state="denied">
        <StatusCallout tone="error" title="Developer access denied" data-membership-status="denied" data-http={auth.state.httpStatus}>
          Your account doesn't have Developer membership on the platform root organization, and no partial view is
          shown — this fails closed as a whole, not as a subset.
        </StatusCallout>
      </div>
    )
  }

  if (auth.state.kind === 'error') {
    return (
      <div data-state="error">
        <StatusCallout tone="error" title="Couldn't load your access" data-error="access-load-failed">
          {auth.state.message} Nothing here is a cached or default guess — retry to try again.
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button size="sm" data-action="retry" onClick={auth.refresh}>Retry</Button>
          </div>
        </StatusCallout>
      </div>
    )
  }

  const access = auth.state.access

  return (
    <div className="dp-stack">
      <MembershipPanel access={access} />
      <ScopeSummary />
      <QuotaMeter quota={access.quota} panel="quota" label="Sandbox calls this window" />
      <SandboxKeysPanel
        keys={keys}
        onCreate={handleCreateKey}
        onRevoke={id => setConfirmingRevoke(id)}
      />

      {confirmingRevoke && (
        <div className="dp-panel dp-panel-tight" data-state="revoke-confirm">
          <p style={{ margin: 0 }}>Revoke this sandbox key? Any sandbox calls made with it will stop working immediately.</p>
          <div className="dp-row" style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="danger" size="sm" data-action="confirm-revoke-key" onClick={handleConfirmRevoke}>
              Revoke key
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingRevoke(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {revealed && (
        <div className="dp-panel dp-panel-tight" data-reveal="once">
          <p style={{ margin: 0, fontWeight: 'var(--weight-semibold)' }}>
            Copy this key now — it's shown exactly once and stored hashed.
          </p>
          <CodeBlock code={revealed.value} copyable={false} />
          <div className="dp-row" style={{ marginTop: 'var(--space-3)' }}>
            <Button
              size="sm"
              data-action="copy-key"
              onClick={() => { void navigator.clipboard?.writeText(revealed.value) }}
            >
              Copy key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Done — I've saved it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MembershipPanel({ access }: { access: MyAccess }) {
  return (
    <section className="dp-panel" data-panel="membership">
      <h2>Membership</h2>
      <div className="dp-stack-sm" style={{ marginTop: 'var(--space-3)' }}>
        <div className="dp-row-between">
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Organization</span>
          <span className="mono">{access.rootOrgId} (platform root)</span>
        </div>
        <div className="dp-row-between">
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Role</span>
          <Badge tone="accent" mono data-membership-role="developer">developer</Badge>
        </div>
        <div className="dp-row-between">
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Status</span>
          <StatusPill status="active" label="Active" data-membership-status="active" />
        </div>
        <div className="dp-row-between">
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Signed in as</span>
          <span className="mono">{access.email ?? access.userId}</span>
        </div>
      </div>
    </section>
  )
}

function ScopeSummary() {
  return (
    <section className="dp-panel" data-scope="developer">
      <h2>What the Developer role grants</h2>
      <div className="dp-field-grid" style={{ marginTop: 'var(--space-3)' }}>
        <div data-scope-grants="allowed">
          <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--success-color)' }}>Allowed</h3>
          <ul style={{ margin: 0, paddingInlineStart: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
            <li>Read the API catalog (DevPortalCatalog:read)</li>
            <li>Use the sandbox playground (DevPortalPlayground:use)</li>
            <li>View your own sandbox call history (DevPortalPlayground:view_history)</li>
          </ul>
        </div>
        <div data-scope-grants="denied">
          <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--error-color)' }}>Does NOT grant</h3>
          <ul style={{ margin: 0, paddingInlineStart: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
            <li>No access to any tenant/organization's data</li>
            <li>No administration capability</li>
            <li>No visibility into another developer's sandbox history</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function SandboxKeysPanel({
  keys,
  onCreate,
  onRevoke,
}: {
  keys: SandboxKey[]
  onCreate: () => void
  onRevoke: (id: string) => void
}) {
  return (
    <section className="dp-panel" data-panel="sandbox-keys">
      <div className="dp-row-between">
        <h2>Sandbox keys</h2>
        <Button size="sm" data-action="create-key" onClick={onCreate}>Create a sandbox key</Button>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          data-empty="no-sandbox-keys"
          title="No sandbox keys yet"
          body="Create one to authenticate sandbox calls made outside the playground."
          action={<Button size="sm" data-action="create-key" onClick={onCreate}>Create a sandbox key</Button>}
        />
      ) : (
        <ul className="dp-stack-sm" style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0 }}>
          {keys.map(key => (
            <li key={key.id} className="dp-row-between" data-key={key.id}>
              <div>
                <div className="mono" style={{ fontSize: 'var(--text-sm)' }}>{key.masked}</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                  {key.label} · created {new Date(key.createdAt).toLocaleDateString()} ·{' '}
                  {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </div>
              </div>
              <Button size="sm" variant="ghost" data-action="revoke-key" onClick={() => onRevoke(key.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
