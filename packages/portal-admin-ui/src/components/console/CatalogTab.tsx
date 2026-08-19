import { Alert, Badge, Button, EmptyState, SortableList, StatusPill } from '@fuzefront/design-system'
import type { PortalCatalogEntry, RegistryApp } from '../../types'

export interface CatalogItem {
  entry: PortalCatalogEntry
  app: RegistryApp | undefined
}

export interface CatalogTabProps {
  state: 'loading' | 'ready' | 'error'
  items: CatalogItem[]
  onRetry: () => void
  onReorder: (nextEntries: PortalCatalogEntry[]) => void
  onAddApp: () => void
  onDisable: (appId: string) => void
}

/** App catalog tab (frame 07-catalog). Enabled apps only; "Add app" opens `AddAppDialog`. */
export function CatalogTab({ state, items, onRetry, onReorder, onAddApp, onDisable }: CatalogTabProps) {
  return (
    <div data-panel="catalog-enabled" data-state={state} aria-busy={state === 'loading' || undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
          <span data-count="enabled">{items.length}</span> app{items.length === 1 ? '' : 's'} enabled · drag to set the
          order they appear in your portal's launcher
        </p>
        <Button variant="primary" data-action="add-app" onClick={onAddApp}>
          Add app
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 'var(--space-10)', background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <div>
          <Alert tone="error" title="We couldn't load this" data-error-code="LOAD_FAILED">
            Something went wrong on our end. Your access hasn't changed — try again.
          </Alert>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" data-action="retry" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState
          icon="🧩"
          title="No apps in your portal yet"
          body="Your launcher is empty. Add apps from the FuzeFront catalog to make them available to your users — you choose which appear and in what order."
          action={
            <Button variant="primary" data-action="add-app" onClick={onAddApp}>
              Browse available apps
            </Button>
          }
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <SortableList<CatalogItem>
          items={items}
          data-list="enabled-apps"
          getKey={item => item.entry.appId}
          renderItem={item => (
            <div
              data-app={item.entry.appId}
              data-enabled="true"
              data-order={item.entry.pinnedOrder}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1 }}
            >
              <span aria-hidden="true">{item.app?.iconUrl ? '🧩' : '📦'}</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>
                  {item.app?.name ?? item.entry.appId}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {item.app?.integrationType ?? 'unknown'}
                </span>
              </div>
              <StatusPill status="enabled" data-app-status="enabled" style={{ marginInlineStart: 'auto' }} />
              <Button variant="ghost" size="sm" data-action="remove-app" data-target={item.entry.appId} onClick={() => onDisable(item.entry.appId)}>
                Remove
              </Button>
            </div>
          )}
          onReorder={next => onReorder(next.map(i => i.entry))}
          ariaLabel="Enabled apps"
        />
      )}
    </div>
  )
}

export interface AddAppDialogProps {
  open: boolean
  available: RegistryApp[]
  onClose: () => void
  onEnable: (appId: string) => void
}

/** Add-app dialog (frame 07-catalog "Add app dialog" panel). */
export function AddAppDialog({ open, available, onClose, onEnable }: AddAppDialogProps) {
  if (!open) return null
  return (
    <div data-panel="add-app" data-state="default" style={{ marginTop: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Available apps</h3>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Apps FuzeFront offers that aren't in your catalog yet
          </p>
        </div>
        <Button variant="ghost" size="sm" data-action="close-add-app" onClick={onClose}>
          Close
        </Button>
      </div>
      {available.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Every catalog app is already enabled.</p>
      ) : (
        <div data-list="available-apps" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {available.map(app => (
            <div
              key={app.id}
              data-app={app.id}
              data-enabled="false"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}
            >
              <span aria-hidden="true">📦</span>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <span style={{ color: 'var(--text-primary)' }}>{app.name}</span>
                <Badge tone="neutral" mono size="sm">
                  {app.integrationType}
                </Badge>
              </div>
              <StatusPill status="disabled" label="Not added" data-app-status="available" />
              <Button variant="primary" size="sm" data-action="enable-app" data-target={app.id} onClick={() => onEnable(app.id)}>
                Add
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
