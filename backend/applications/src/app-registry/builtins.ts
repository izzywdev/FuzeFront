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
      remoteEntry: 'https://app.fuzefront.com/apps/clock/assets/remoteEntry.js',
      scope: 'clockApp',
      module: './ClockApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/clock' },
    visibility: 'public',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'fuze-sales',
    name: 'FuzeSales',
    menuLabel: 'Sales',
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      remoteEntry: 'https://fuzesales.prod.fuzefront.com/remoteEntry.js',
      scope: 'fuze-sales',
      module: './FuzeSalesApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/sales' },
    visibility: 'public',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'fuze-contact',
    name: 'FuzeContact',
    menuLabel: 'Contact',
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      remoteEntry: 'https://fuzecontact.prod.fuzefront.com/remoteEntry.js',
      scope: 'fuzecontact',
      module: './FuzeContactApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/contact' },
    visibility: 'public',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'fuze-service',
    name: 'FuzeService',
    menuLabel: 'Service',
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      remoteEntry: 'https://fuzeservice.prod.fuzefront.com/remoteEntry.js',
      scope: 'fuzeservice',
      module: './FuzeServiceApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/service' },
    visibility: 'public',
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
