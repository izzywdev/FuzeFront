interface NavItemDef {
  icon: string
  label: string
  active?: boolean
}

const NAV_ITEMS: NavItemDef[] = [
  { icon: '🏠', label: 'Home', active: true },
  { icon: '▦', label: 'Apps' },
  { icon: '👥', label: 'Team' },
  { icon: '📊', label: 'Reports' },
]

const WORKSPACE_ITEMS: NavItemDef[] = [
  { icon: '⚙️', label: 'Settings' },
  { icon: '🎨', label: 'Branding' },
  { icon: '🔒', label: 'Security' },
]

/**
 * The pre-auth portal shell's side nav (frame 01, `[data-region="side-panel"]`).
 * The active item's tint (`--accent-soft`/`--accent-color`) comes from the
 * `PortalThemeScope` ancestor, not from anything local to this component —
 * that is the whole point of the token-override architecture (frame 02 proves
 * the identical markup reskins with zero component change).
 */
export function BrandedSidePanel() {
  return (
    <nav
      data-region="side-panel"
      aria-label="Portal navigation"
      style={{
        width: '15rem',
        flex: 'none',
        padding: 'var(--space-4) 0',
        background: 'var(--bg-tertiary)',
        borderInlineEnd: '1px solid var(--border-color)',
        overflowY: 'auto',
      }}
    >
      {NAV_ITEMS.map(item => (
        <NavRow key={item.label} {...item} />
      ))}
      <div
        style={{
          padding: 'var(--space-4) var(--space-4) var(--space-2)',
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        Workspace
      </div>
      {WORKSPACE_ITEMS.map(item => (
        <NavRow key={item.label} {...item} />
      ))}
    </nav>
  )
}

function NavRow({ icon, label, active = false }: NavItemDef) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        width: '100%',
        padding: 'var(--space-2) var(--space-4)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
        border: 'none',
        textAlign: 'start',
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
