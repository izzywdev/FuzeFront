import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  AppManifest,
  AppMode,
  IntegrationType,
  Visibility,
} from '@fuzefront/app-registry-client'
import { Input, Select, Button, Badge } from '@fuzefront/design-system'
import { useAppRegistry } from '../platform/appRegistry'

const SLUG_RE = /^[a-z0-9-]+$/

type ChromeMenu = 'host' | 'substitute'

/**
 * Add-application flow (frame 02-register-activate): collect manifest fields,
 * validate, then register → activate. On success the app appears in the menu
 * (e.g. a "FuzeMarket" manifest with menuLabel "Market" shows "Market").
 */
function AddApplicationPage() {
  const navigate = useNavigate()
  const { registerAndActivate } = useAppRegistry()

  const [slug, setSlug] = useState('')
  const [menuLabel, setMenuLabel] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<AppMode>('portal')
  const [integrationType, setIntegrationType] =
    useState<IntegrationType>('module-federation')
  const [remoteEntry, setRemoteEntry] = useState('')
  const [scope, setScope] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [url, setUrl] = useState('')
  const [iconEmoji, setIconEmoji] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('organization')
  const [chromeMenu, setChromeMenu] = useState<ChromeMenu>('host')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activatedSlug, setActivatedSlug] = useState<string | null>(null)

  const isMF = integrationType === 'module-federation'
  const isUrlBased =
    integrationType === 'iframe' || integrationType === 'spa'

  // Build the manifest from the form (used for both the live preview + submit).
  const manifest: AppManifest = useMemo(
    () => ({
      manifestVersion: '1',
      slug,
      name: name || menuLabel,
      menuLabel,
      ...(description ? { description } : {}),
      ...(iconEmoji ? { icon: { kind: 'emoji' as const, value: iconEmoji } } : {}),
      mode,
      builtin: false,
      integration: {
        type: integrationType,
        ...(isMF
          ? { remoteEntry, scope, module: moduleName }
          : {}),
        ...(isUrlBased && url ? { url } : {}),
      },
      ...(mode === 'portal'
        ? { chrome: { menu: chromeMenu, topbar: 'host' as const } }
        : {}),
      visibility,
      roles: [],
    }),
    [
      slug,
      name,
      menuLabel,
      description,
      iconEmoji,
      mode,
      integrationType,
      isMF,
      isUrlBased,
      remoteEntry,
      scope,
      moduleName,
      url,
      chromeMenu,
      visibility,
    ],
  )

  const slugError =
    slug.length > 0 && !SLUG_RE.test(slug)
      ? 'lowercase letters, digits, hyphens only'
      : undefined

  const canSubmit =
    !!slug &&
    !slugError &&
    !!menuLabel &&
    !!(name || menuLabel) &&
    (isMF ? !!remoteEntry && !!scope && !!moduleName : true) &&
    (isUrlBased ? !!url : true)

  const onSubmit = async () => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      const app = await registerAndActivate({ manifest })
      setActivatedSlug(app.slug)
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to register the app',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
          letterSpacing: 'var(--tracking-display)',
          margin: '0 0 var(--space-2)',
        }}
      >
        Add application
      </h1>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 var(--space-6)' }}>
        Register an app from its <b>manifest</b>. It starts <b>registered</b>{' '}
        (hidden), then it is <b>activated</b> to appear in the menu.
      </p>

      {/* lifecycle steps */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
        }}
      >
        <span>① Manifest</span>
        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
        <Badge tone="warning">registered</Badge>
        <span style={{ color: 'var(--text-tertiary)' }}>→</span>
        <Badge tone="success">activated</Badge>
      </div>

      {activatedSlug ? (
        <div
          style={{
            padding: 'var(--space-6)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            maxWidth: '560px',
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            ✅ {manifest.menuLabel} is now activated
          </h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            <Badge tone="success" dot>
              activated
            </Badge>{' '}
            It now appears in the application menu as{' '}
            <b>{manifest.menuLabel}</b>.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <Button variant="primary" onClick={() => navigate('/applications')}>
              Back to applications
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/app/${activatedSlug}`)}>
              Open {manifest.menuLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 0.9fr)',
            gap: 'var(--space-8)',
            alignItems: 'start',
          }}
        >
          {/* form card */}
          <div
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Input
                label="Slug *"
                value={slug}
                error={slugError}
                placeholder="market"
                onChange={e => setSlug(e.target.value)}
              />
              <Input
                label="Menu label *"
                value={menuLabel}
                placeholder="Market"
                onChange={e => setMenuLabel(e.target.value)}
              />
            </div>
            <Input
              label="Display name *"
              value={name}
              placeholder="Market"
              onChange={e => setName(e.target.value)}
            />
            <Input
              label="Icon (emoji)"
              value={iconEmoji}
              placeholder="🛒"
              onChange={e => setIconEmoji(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Select
                label="Mode *"
                value={mode}
                onChange={e => setMode(e.target.value as AppMode)}
                options={[
                  { value: 'portal', label: 'portal' },
                  { value: 'standalone', label: 'standalone' },
                ]}
              />
              <Select
                label="Integration type *"
                value={integrationType}
                onChange={e => setIntegrationType(e.target.value as IntegrationType)}
                options={[
                  { value: 'module-federation', label: 'module-federation' },
                  { value: 'iframe', label: 'iframe' },
                  { value: 'web-component', label: 'web-component' },
                  { value: 'spa', label: 'spa' },
                ]}
              />
            </div>

            {isMF && (
              <>
                <Input
                  label="Remote entry URL *"
                  value={remoteEntry}
                  placeholder="https://market.example.com/remoteEntry.js"
                  onChange={e => setRemoteEntry(e.target.value)}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <Input
                    label="Scope *"
                    value={scope}
                    placeholder="marketApp"
                    onChange={e => setScope(e.target.value)}
                  />
                  <Input
                    label="Module *"
                    value={moduleName}
                    placeholder="./MarketApp"
                    onChange={e => setModuleName(e.target.value)}
                  />
                </div>
              </>
            )}

            {isUrlBased && (
              <Input
                label="App URL *"
                value={url}
                placeholder="https://market.example.com"
                onChange={e => setUrl(e.target.value)}
              />
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <Select
                label="Visibility"
                value={visibility}
                onChange={e => setVisibility(e.target.value as Visibility)}
                options={[
                  { value: 'organization', label: 'organization' },
                  { value: 'private', label: 'private' },
                  { value: 'public', label: 'public' },
                  { value: 'marketplace', label: 'marketplace' },
                ]}
              />
              {mode === 'portal' && (
                <Select
                  label="Menu chrome"
                  value={chromeMenu}
                  onChange={e => setChromeMenu(e.target.value as ChromeMenu)}
                  options={[
                    { value: 'host', label: 'host (keep portal menu)' },
                    { value: 'substitute', label: 'substitute (app owns menu)' },
                  ]}
                />
              )}
            </div>

            {submitError && (
              <div
                style={{
                  color: 'var(--error-color)',
                  fontSize: 'var(--text-sm)',
                  marginTop: 'var(--space-3)',
                }}
              >
                {submitError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
              <Button variant="ghost" onClick={() => navigate('/applications')}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!canSubmit || submitting}
                onClick={onSubmit}
              >
                {submitting ? 'Registering…' : 'Register & activate'}
              </Button>
            </div>
          </div>

          {/* live manifest preview */}
          <aside
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
            }}
          >
            <h4
              style={{
                margin: '0 0 var(--space-3)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-2xs)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-wide)',
                color: 'var(--text-tertiary)',
              }}
            >
              POST /api/v1/app-registry/apps
            </h4>
            <pre
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify({ manifest }, null, 2)}
            </pre>
          </aside>
        </div>
      )}
    </div>
  )
}

export default AddApplicationPage
