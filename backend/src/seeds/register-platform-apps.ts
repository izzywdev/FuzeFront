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
      console.log(`[skip] ${app.slug} already registered`)
      return
    }
    await axios.post(`${API}/api/v1/app-registry/apps`, { slug: app.slug, manifest: app.manifest }, { headers })
    await axios.post(`${API}/api/v1/app-registry/apps/${app.slug}/activate`, {}, { headers })
    console.log(`[ok] registered + activated ${app.slug}`)
  } catch (err: any) {
    console.error(`[error] ${app.slug}:`, err.response?.data || err.message)
  }
}

async function main() {
  for (const app of APPS) await registerApp(app)
}

main()
