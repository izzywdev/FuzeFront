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
      // NO `assets/` segment: clock-app/vite.config.ts sets `assetsDir: ''`
      // (flat build output), so remoteEntry.js is served at the root of
      // `/apps/clock/`, matching clock-app/nginx.conf's `location = /remoteEntry.js`.
      // Existing rows are re-pointed by migration 010 (upsertBuiltin never
      // touches an already-registered row, so this seed alone is inert on prod).
      remoteEntry: '/apps/clock/remoteEntry.js',
      scope: 'clockApp',
      module: './ClockApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    nav: { section: 'platform', order: 90 },
    routing: { path: '/clock' },
    visibility: 'public',
    roles: [],
  },
  // REMOVED 2026-08-25: the `fuzequality` built-in was a PHANTOM TILE.
  //
  // It seeded an activated, menu-visible app pointing at
  // /apps/fuzequality/assets/remoteEntry.js for a product that DOES NOT EXIST.
  // There is no `FuzeQuality` repository under any account this platform can
  // reach — verified against the full repo listing (24 repos across izzywdev,
  // FuzeOne and fuzeone2026; none is FuzeQuality). Nothing builds that bundle,
  // nothing serves that path, and no chart mounts it. The tile appeared in
  // every user's menu and white-screened on click.
  //
  // It also outlived its own evidence: migration 010's comment reasons about
  // "fuzequality/apps/web/vite.config.ts" having no assetsDir override. That
  // file is not reachable either. The `/assets/` segment in the removed entry
  // came from that same assumption — 008 applied one path shape to both `clock`
  // and `fuzequality`, 010 corrected `clock`, and nobody could correct this one
  // because there was nothing to check it against.
  //
  // DO NOT RE-ADD without a repository that builds and serves the bundle. A
  // built-in is seeded `activated` on every boot, so an entry here is a
  // user-visible promise; make it only for something that exists. If FuzeQuality
  // is built later, re-add the entry AND revert migration 011.
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
