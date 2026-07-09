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
      remoteEntry: 'https://fuzeagent.prod.fuzefront.com/remoteEntry.js',
      scope: 'fuzeagentApp',
      module: './FuzeAgentApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/app/fuzeagent' },
    visibility: 'organization',
    roles: [],
  },
  {
    manifestVersion: '1',
    slug: 'mendys',
    name: 'MendysRobotics',
    menuLabel: 'Robotics',
    description:
      'MendysRobotics management platform — monitor robot fleets, scraper jobs, and operational status in real time.',
    icon: { kind: 'emoji', value: '🤖' },
    mode: 'portal',
    builtin: true,
    integration: {
      type: 'module-federation',
      remoteEntry: 'https://mendys.prod.fuzefront.com/remoteEntry.js',
      scope: 'mendysApp',
      module: './MendysApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/app/mendys' },
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
    slug: 'fuzekeys',
    name: 'FuzeKeys',
    menuLabel: 'Keys',
    description:
      'Keys, secrets, and PII tokenization — AI-powered credential management.',
    icon: { kind: 'emoji', value: '🔑' },
    mode: 'portal',
    builtin: false,
    integration: {
      type: 'module-federation',
      remoteEntry:
        'https://keys.prod.fuzefront.com/apps/fuzekeys/assets/remoteEntry.js',
      scope: 'fuzeKeysApp',
      module: './FuzeKeysApp',
    },
    chrome: { menu: 'host', topbar: 'host' },
    routing: { path: '/keys' },
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