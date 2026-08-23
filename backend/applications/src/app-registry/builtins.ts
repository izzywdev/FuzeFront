import { randomBytes } from 'crypto'
import { appRegistryService } from './service'
import { appManifestSchema, AppManifest } from './manifest.schema'

// Built-in apps shipped with the platform. Provisioned idempotently on boot
// (production included) so they appear in the menu out of the box. The canonical
// manifest source is services/app-registry-service/seed/clock.manifest.json, but
// that path is not present in the applications-service container image
// (backend/applications/Dockerfile copies only backend/applications + core +
// shared), so the manifest is embedded here verbatim and validated against the
// FROZEN AppManifest contract on load.
const BUILTIN_MANIFESTS: unknown[] = [
  {
    manifestVersion: '1',
    slug: 'fuzesocial',
    name: 'FuzeSocial',
    menuLabel: 'Social',
    description:
      'Social media automation, scheduling, and cross-platform publishing — Facebook, Instagram, TikTok, YouTube, Reddit, X, and WhatsApp.',
    icon: { kind: 'emoji', value: '📱' },
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'iframe',
      url: 'https://social.prod.fuzefront.com',
    },
    chrome: { menu: 'host', topbar: 'host' },
    nav: { section: 'revenue', order: 40 },
    routing: { path: '/app/fuzesocial' },
    visibility: 'organization',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'fuzeagent',
    name: 'FuzeAgent',
    menuLabel: 'Agents',
    description:
      'AI team orchestration platform — create and manage autonomous AI agents (Claude Code SDK + CrewAI) coordinated by a digital CEO (IzzyAI).',
    icon: { kind: 'emoji', value: '🤖' },
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      // Same-origin path, not an absolute app-host URL: identical value works
      // on app.fuzefront.com, a tenant wildcard host, and localhost. Existing
      // rows are re-pointed by migration 009 (upsertBuiltin never touches an
      // already-registered row, so this seed alone is inert on prod).
      remoteEntry: '/apps/fuzeagent/remoteEntry.js',
      scope: 'fuzeagentApp',
      module: './FuzeAgentApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    nav: { section: 'build', order: 10 },
    routing: { path: '/app/fuzeagent' },
    visibility: 'organization',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'clock',
    name: 'Clock',
    menuLabel: 'Clock',
    description:
      'Built-in reference app: a simple world clock. The canonical example of a federated, portal-mode FuzeFront app, shipped with the platform.',
    icon: { kind: 'emoji', value: '🕐' },
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      // Same-origin path, not an absolute app-host URL: identical value works on
      // app.fuzefront.com, a tenant wildcard host, and localhost.
      remoteEntry: '/apps/clock/assets/remoteEntry.js',
      scope: 'clockApp',
      module: './ClockApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    nav: { section: 'platform', order: 90 },
    routing: { path: '/clock' },
    visibility: 'public',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'fuzequality',
    name: 'FuzeQuality',
    menuLabel: 'Quality',
    description:
      'API, frontend, test, and requirement coverage intelligence across the FuzeFront product family.',
    icon: { kind: 'emoji', value: '🧪' },
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      remoteEntry: '/apps/fuzequality/assets/remoteEntry.js',
      scope: 'fuzequality',
      module: './App',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/app/fuzequality' },
    visibility: 'organization',
    roles: [],
  },
]

/**
 * Idempotently provisions the built-in apps as `builtin:true`, `status:activated`
 * (upsert by slug — existing rows are left untouched). Safe to call on every boot.
 * Best-effort: a failure here logs and does NOT abort startup.
 */
export async function ensureBuiltins(): Promise<void> {
  for (const raw of BUILTIN_MANIFESTS) {
    try {
      const manifest: AppManifest = appManifestSchema.parse(raw)
      await appRegistryService.upsertBuiltin(
        manifest,
        'activated',
        randomBytes(32).toString('hex')
      )
    } catch (err) {
      console.error(
        '[app-registry] failed to provision built-in app (continuing):',
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
