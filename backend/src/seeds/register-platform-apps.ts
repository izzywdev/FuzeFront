/**
 * One-time seed: registers FuzeSales, FuzeContact, FuzeService in the FuzeFront
 * app registry so they appear in the App selector menu.
 *
 * Run: npx ts-node src/seeds/register-platform-apps.ts
 * Idempotent: skips apps that are already registered.
 */
import axios from 'axios'

const API = process.env.FUZEFRONT_API_URL || 'http://localhost:3001'
const TOKEN = process.env.SEED_API_TOKEN  // admin JWT or service token

const APPS = [
  {
    slug: 'fuzesales',
    manifest: {
      manifestVersion: '1',
      slug: 'fuzesales',
      name: 'FuzeSales',
      menuLabel: 'Sales',
      description: 'CRM and sales pipeline management',
      icon: { kind: 'emoji', value: '💼' },
      mode: 'portal',
      builtin: false,
      integration: {
        type: 'module-federation',
        remoteEntry: process.env.FUZESALES_REMOTE_ENTRY || 'https://sales.fuzefront.com/remoteEntry.js',
        scope: 'fuzesales',
        module: './FuzeSalesApp',
      },
      chrome: { menu: 'host', topbar: 'host' },
      routing: { path: '/app/fuzesales' },
      visibility: 'organization',
    },
  },
  {
    slug: 'fuzecontact',
    manifest: {
      manifestVersion: '1',
      slug: 'fuzecontact',
      name: 'FuzeContact',
      menuLabel: 'Contact',
      description: 'Omnichannel contact and conversation management',
      icon: { kind: 'emoji', value: '📞' },
      mode: 'portal',
      builtin: false,
      integration: {
        type: 'module-federation',
        remoteEntry: process.env.FUZECONTACT_REMOTE_ENTRY || 'https://contact.fuzefront.com/remoteEntry.js',
        scope: 'fuzecontact',
        module: './FuzeContactApp',
      },
      chrome: { menu: 'host', topbar: 'host' },
      routing: { path: '/app/fuzecontact' },
      visibility: 'organization',
    },
  },
  {
    slug: 'fuzeservice',
    manifest: {
      manifestVersion: '1',
      slug: 'fuzeservice',
      name: 'FuzeService',
      menuLabel: 'Service',
      description: 'Helpdesk and customer service management',
      icon: { kind: 'emoji', value: '🎧' },
      mode: 'portal',
      builtin: false,
      integration: {
        type: 'module-federation',
        remoteEntry: process.env.FUZESERVICE_REMOTE_ENTRY || 'https://service.fuzefront.com/remoteEntry.js',
        scope: 'fuzeservice',
        module: './FuzeServiceApp',
      },
      chrome: { menu: 'host', topbar: 'host' },
      routing: { path: '/app/fuzeservice' },
      visibility: 'organization',
    },
  },
]

async function registerApp(app: typeof APPS[0]) {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  try {
    // Check if already registered
    const check = await axios.get(`${API}/api/v1/app-registry/apps/${app.slug}`, { headers }).catch(() => null)
    if (check?.data?.slug === app.slug) {
      console.log(`[skip] ${app.slug} already registered`)
      return
    }
    // Register
    await axios.post(`${API}/api/v1/app-registry/apps`, { slug: app.slug, manifest: app.manifest }, { headers })
    // Activate
    await axios.post(`${API}/api/v1/app-registry/apps/${app.slug}/activate`, {}, { headers })
    console.log(`[ok] registered + activated ${app.slug}`)
  } catch (err: any) {
    console.error(`[error] ${app.slug}:`, err.response?.data || err.message)
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
