/**
 * One-time seed: registers platform apps in the FuzeFront app registry
 * so they appear in the App selector menu.
 *
 * Run: npx ts-node src/seeds/register-platform-apps.ts
 * Idempotent: skips apps that are already registered.
 *
 * FuzeSales, FuzeContact, and FuzeService self-register at pod startup
 * via a Kubernetes init container in each app's own Helm chart.
 * See docs/mfe-self-registration.md for the pattern.
 */
import axios from 'axios'

const API = process.env.FUZEFRONT_API_URL || 'http://localhost:3001'
const TOKEN = process.env.SEED_API_TOKEN  // admin JWT or service token

const APPS: Array<{ slug: string; manifest: Record<string, unknown> }> = [
  // Add platform-managed built-ins here.
  // Product MFEs (FuzeSales, FuzeContact, FuzeService) self-register from their own repos.
]

async function registerApp(app: typeof APPS[0]) {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  try {
    const check = await axios.get(`${API}/api/v1/app-registry/apps/${app.slug}`, { headers }).catch(() => null)
    if (check?.data?.slug === app.slug) {
      console.log('[skip] %s already registered', app.slug)
      return
    }
    await axios.post(`${API}/api/v1/app-registry/apps`, { slug: app.slug, manifest: app.manifest }, { headers })
    await axios.post(`${API}/api/v1/app-registry/apps/${app.slug}/activate`, {}, { headers })
    console.log('[ok] registered + activated %s', app.slug)
  } catch (err: any) {
    // Constant format string: never interpolate a non-literal into the
    // message itself (forged format specifiers / log injection). Only
    // `err.response?.data` / `err.message` are logged — never `err` itself,
    // whose `config.headers` carries the `Authorization: Bearer <token>`.
    console.error('[error] %s:', app.slug, err.response?.data || err.message)
  }
}

async function main() {
  for (const app of APPS) await registerApp(app)
}

// No-op Knex seed export so this file passes seed validation.
// The actual work (HTTP registration) only runs when executed directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seed(_knex: any): Promise<void> {}

if (require.main === module) {
  main().catch(console.error)
}
