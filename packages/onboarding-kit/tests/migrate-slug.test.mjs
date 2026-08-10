// Tests for bin/migrate-slug.mjs.
//
// The pure planning functions are tested directly. Everything that decides whether a
// DELETE happens is tested END TO END against tests/fake-registry.mjs, because the
// safety property being asserted is about the state of a registry after a sequence of
// real HTTP calls — a mocked client could be made to agree with a broken tool.
//
// The property under test throughout: THE PRODUCT IS NEVER LEFT UNREGISTERED. Every
// failure case asserts not only that the tool reported failure, but that the old app
// is still there afterwards.

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RegistryClient,
  migrate,
  planFrom,
  rewriteManifest,
  detectSuiteMembers,
  validateSlugs,
  parseArgs,
  MigrationRefused,
} from '../bin/migrate-slug.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'test-token'

const manifestFor = (slug, name, extra = {}) => ({
  manifestVersion: '1',
  slug,
  name,
  menuLabel: name,
  mode: 'portal',
  modes: ['portal', 'standalone'],
  integration: {
    type: 'module-federation',
    remoteEntry: `https://${slug}.example.com/remoteEntry.js`,
    scope: `${slug}App`,
    module: './App',
  },
  nav: { section: 'build', order: 10 },
  routing: { path: `/app/${slug}`, host: `${slug}.fuzefront.com` },
  visibility: 'organization',
  ...extra,
})

/** Acknowledgements the operator would pass on the CLI. */
const ACK = { permitGrants: true, installs: true }
const silent = () => {}

// ---- pure planning ------------------------------------------------------------------

describe('planFrom', () => {
  test('old present, new absent -> register', () => {
    assert.equal(planFrom({ status: 200 }, { status: 404 }).action, 'register')
  })
  test('both present -> resume at verify-and-delete', () => {
    // A previous run registered the replacement and then died. Resuming must NOT
    // re-register (409) and must NOT skip straight to delete without verifying.
    assert.equal(planFrom({ status: 200 }, { status: 200 }).action, 'verify-and-delete')
  })
  test('old absent, new present -> noop (already migrated)', () => {
    assert.equal(planFrom({ status: 404 }, { status: 200 }).action, 'noop')
  })
  test('neither present -> absent, which is a FAILURE not a quiet success', () => {
    // "nothing to do" and "you typed the slug wrong" read identically against the
    // registry. Exiting 0 on the second is how a migration gets ticked off without
    // having happened.
    assert.equal(planFrom({ status: 404 }, { status: 404 }).action, 'absent')
  })
})

describe('validateSlugs', () => {
  test('rejects a --to that is still prefixed', () => {
    assert.throws(() => validateSlugs({ from: 'fuzeservice', to: 'fuzeservice2' }), MigrationRefused)
  })
  test('rejects a --from that is NOT prefixed — this is not a general rename tool', () => {
    assert.throws(() => validateSlugs({ from: 'picker', to: 'chooser' }), /general rename/)
  })
  test('rejects from === to', () => {
    assert.throws(() => validateSlugs({ from: 'fuzeservice', to: 'fuzeservice' }), /nothing to migrate/)
  })
  test('rejects a --to that violates the contract Slug pattern', () => {
    assert.throws(() => validateSlugs({ from: 'fuzeservice', to: 'Service' }), /not a valid slug/)
  })
  test('accepts the real fuzeservice -> service case', () => {
    assert.doesNotThrow(() => validateSlugs({ from: 'fuzeservice', to: 'service' }))
  })
})

describe('rewriteManifest', () => {
  const { manifest: out, notes } = rewriteManifest(
    manifestFor('fuzeservice', 'FuzeService'),
    'fuzeservice',
    'service'
  )

  test('rewrites slug, name, menuLabel and the /app/<slug> path', () => {
    assert.equal(out.slug, 'service')
    assert.equal(out.name, 'Service')
    assert.equal(out.menuLabel, 'Service')
    assert.equal(out.routing.path, '/app/service')
  })

  test('does NOT rewrite routing.host — a hostname needs DNS, a cert and an ingress', () => {
    assert.equal(out.routing.host, 'fuzeservice.fuzefront.com')
    assert.match(notes.join('\n'), /routing\.host.*was NOT changed/s)
  })

  test('does NOT rewrite integration.scope — it must match the deployed bundle', () => {
    // The MF scope is the global the remote publishes itself under at runtime. Rewriting
    // it here would point the host at a global the bundle never defines: the remote
    // fails to load in the browser, with nothing server-side to catch it.
    assert.equal(out.integration.scope, 'fuzeserviceApp')
    assert.match(notes.join('\n'), /integration\.scope.*was NOT changed/s)
  })

  test('leaves a hand-written routing.path alone rather than guessing', () => {
    const { manifest } = rewriteManifest(
      manifestFor('fuzeservice', 'FuzeService', { routing: { path: '/app/support-desk' } }),
      'fuzeservice',
      'service'
    )
    assert.equal(manifest.routing.path, '/app/support-desk')
  })

  test('leaves an already-correct name alone (FuzePicker/picker asymmetry)', () => {
    const { manifest } = rewriteManifest(
      manifestFor('fuzecontact', 'Contact'),
      'fuzecontact',
      'contact'
    )
    assert.equal(manifest.name, 'Contact')
  })

  test('does not mutate its input', () => {
    const input = manifestFor('fuzeservice', 'FuzeService')
    rewriteManifest(input, 'fuzeservice', 'service')
    assert.equal(input.slug, 'fuzeservice')
  })
})

describe('detectSuiteMembers', () => {
  const hub = [
    { slug: 'fuzehub', manifest: { nav: { suite: { id: 'fuzehub' } } } },
    { slug: 'fuzehub-talent', manifest: { nav: { suite: { id: 'fuzehub' } } } },
    { slug: 'fuzehub-recruiter', manifest: { nav: { suite: { id: 'fuzehub' } } } },
    { slug: 'fuzeservice', manifest: { nav: {} } },
  ]

  test('finds siblings by slug prefix AND by shared nav.suite.id', () => {
    assert.deepEqual(detectSuiteMembers('fuzehub', hub), ['fuzehub-recruiter', 'fuzehub-talent'])
  })

  test('a standalone product has no siblings', () => {
    assert.deepEqual(detectSuiteMembers('fuzeservice', hub), [])
  })

  test('a sibling with no nav.suite at all is still caught by the slug prefix', () => {
    const apps = [{ slug: 'fuzehub' }, { slug: 'fuzehub-talent' }]
    assert.deepEqual(detectSuiteMembers('fuzehub', apps), ['fuzehub-talent'])
  })
})

describe('parseArgs', () => {
  test('dry run and both acknowledgements default to OFF', () => {
    const a = parseArgs(['--from', 'fuzeservice', '--to', 'service'])
    assert.equal(a.apply, false)
    assert.equal(a.permitGrants, false)
    assert.equal(a.installs, false)
  })
  test('an unknown flag is fatal, not ignored', () => {
    // A typo'd --aply that silently parsed as a dry run would report success having
    // changed nothing; a typo'd --permit-grant would be worse.
    assert.throws(() => parseArgs(['--aply']), MigrationRefused)
  })
})

// ---- end to end against the fake registry -------------------------------------------

describe('migrate against the fake registry', () => {
  let server
  let registry
  let workDir

  const start = () =>
    new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [join(HERE, 'fake-registry.mjs')], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let buf = ''
      proc.stdout.on('data', d => {
        buf += d
        const m = buf.match(/^LISTENING (\d+)$/m)
        if (m) resolve({ proc, port: Number(m[1]) })
      })
      proc.on('error', reject)
      setTimeout(() => reject(new Error('fake registry did not start')), 5000)
    })

  before(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'migrate-'))
  })

  beforeEach(async () => {
    // A fresh registry per test — these tests DELETE things, and a shared instance
    // would make each case depend on the order of the previous ones.
    if (server) server.kill()
    server = undefined
    const started = await start()
    server = started.proc
    registry = new RegistryClient(`http://127.0.0.1:${started.port}`, TOKEN, silent)
  })

  after(() => {
    if (server) server.kill()
  })

  /** Seed a registered + activated app. */
  async function seed(slug, name, extra = {}) {
    const r = await registry.registerApp(manifestFor(slug, name, extra))
    assert.equal(r.status, 201, `seed ${slug}: ${r.text}`)
    await registry.activateApp(slug)
  }

  const run = opts => migrate(registry, { from: 'fuzeservice', to: 'service', log: silent, ...opts })

  test('DRY RUN is the default and changes nothing', async () => {
    await seed('fuzeservice', 'FuzeService')
    const res = await run({ ...ACK })
    assert.equal(res.ok, true)
    assert.equal((await registry.getApp('fuzeservice')).status, 200, 'old app must survive a dry run')
    assert.equal((await registry.getApp('service')).status, 404, 'dry run must not register anything')
  })

  test('a DRY RUN without the acknowledgements still produces a full plan', async () => {
    // The acknowledgements gate the DELETE, not the preview. If a dry run stopped at
    // them you could not see the plan without first passing the flags — which turns a
    // deliberate confirmation into something typed reflexively to get any output at all.
    await seed('fuzeservice', 'FuzeService')
    const res = await run({})
    assert.equal(res.ok, true)
    const out = res.steps.join('\n')
    assert.match(out, /WARNING \(would block --apply\).*--permit-grants/s)
    assert.match(out, /WARNING \(would block --apply\).*--installs/s)
    assert.match(out, /slug: fuzeservice -> service/, 'the plan itself must still be shown')
    assert.match(out, /DRY RUN: would POST \/apps with slug "service".*DELETE \/apps\/fuzeservice/s)
    assert.equal((await registry.getApp('fuzeservice')).status, 200)
    assert.equal((await registry.getApp('service')).status, 404)
  })

  test('--apply performs the full two-step correction', async () => {
    await seed('fuzeservice', 'FuzeService')
    const res = await run({ ...ACK, apply: true })
    assert.equal(res.ok, true, res.refusal)

    const now = await registry.getApp('service')
    assert.equal(now.status, 200)
    assert.equal(now.app.status, 'activated', 'the replacement must be ACTIVE, not merely registered')
    assert.equal(now.app.manifest.slug, 'service')
    assert.equal(now.app.manifest.name, 'Service')
    assert.equal(now.app.manifest.routing.path, '/app/service')

    assert.equal((await registry.getApp('fuzeservice')).status, 404, 'the prefixed app must be gone')
  })

  test('is idempotent — a second --apply run is a clean no-op', async () => {
    await seed('fuzeservice', 'FuzeService')
    await run({ ...ACK, apply: true })
    const second = await run({ ...ACK, apply: true })
    assert.equal(second.ok, true, second.refusal)
    assert.equal(second.action, 'noop')
    assert.equal((await registry.getApp('service')).status, 200)
  })

  test('resumes a half-finished migration (both rows present) and deletes the old one', async () => {
    // This is the state left by a run that was interrupted between step 1 and step 2 —
    // and it is exactly the state a product creates for itself by de-prefixing its
    // manifest and redeploying, since register.sh only ever does step 1.
    await seed('fuzeservice', 'FuzeService')
    await seed('service', 'Service')
    const res = await run({ ...ACK, apply: true })
    assert.equal(res.ok, true, res.refusal)
    assert.equal(res.action, 'verify-and-delete')
    assert.equal((await registry.getApp('fuzeservice')).status, 404)
    assert.equal((await registry.getApp('service')).status, 200)
  })

  test('REFUSES without --permit-grants, and the old app survives', async () => {
    await seed('fuzeservice', 'FuzeService')
    const res = await run({ installs: true, apply: true })
    assert.equal(res.ok, false)
    assert.match(res.refusal, /--permit-grants/)
    assert.match(res.refusal, /silently lose the role/)
    assert.equal((await registry.getApp('fuzeservice')).status, 200)
    assert.equal((await registry.getApp('service')).status, 404, 'a refusal must not half-register')
  })

  test('REFUSES without --installs, and the old app survives', async () => {
    await seed('fuzeservice', 'FuzeService')
    const res = await run({ permitGrants: true, apply: true })
    assert.equal(res.ok, false)
    assert.match(res.refusal, /ON DELETE CASCADE/)
    assert.equal((await registry.getApp('fuzeservice')).status, 200)
  })

  test('REFUSES a built-in app up front, before registering any duplicate', async () => {
    // DELETE 403s on built-ins, so the migration could never finish — it would only ever
    // add a permanent second tile. Refusing before step 1 is what keeps that from
    // happening.
    await seed('fuzeservice', 'FuzeService', { builtin: true })
    const res = await run({ ...ACK, apply: true })
    assert.equal(res.ok, false)
    assert.match(res.refusal, /BUILT-IN/)
    assert.equal((await registry.getApp('service')).status, 404, 'must not register a duplicate it can never clean up')
    assert.equal((await registry.getApp('fuzeservice')).status, 200)
  })

  test('REFUSES a suite parent (the FuzeHub case) and names the siblings', async () => {
    await seed('fuzehub', 'FuzeHub', { nav: { section: 'build', order: 1, suite: { id: 'fuzehub', label: 'Hub', order: 1 } } })
    await seed('fuzehub-talent', 'FuzeHub Talent', { nav: { section: 'build', order: 2, suite: { id: 'fuzehub', label: 'Hub', order: 1 } } })
    const res = await migrate(registry, { from: 'fuzehub', to: 'hub', apply: true, log: silent, ...ACK })
    assert.equal(res.ok, false)
    assert.match(res.refusal, /SUITE PARENT/)
    assert.match(res.refusal, /fuzehub-talent/)
    assert.equal((await registry.getApp('fuzehub')).status, 200)
    assert.equal((await registry.getApp('hub')).status, 404)
  })

  test('preserves a SUSPENDED app\'s status instead of switching it on', async () => {
    // Migrating must not be a side door that activates something an operator
    // deliberately turned off.
    await registry.registerApp(manifestFor('fuzeplan', 'FuzePlan'))
    const res = await migrate(registry, {
      from: 'fuzeplan',
      to: 'plan',
      apply: true,
      log: silent,
      ...ACK,
    })
    assert.equal(res.ok, true, res.refusal)
    const now = await registry.getApp('plan')
    assert.equal(now.app.status, 'registered', 'must NOT have been activated')
    assert.equal((await registry.getApp('fuzeplan')).status, 404)
  })

  test('re-submits policy.json and billing-profile.json under the NEW slug', async () => {
    // GET /apps/{slug} cannot return them — `App` is additionalProperties:false over a
    // field list that excludes both. They can only come from the product's own
    // registration/ directory, so the tool must actually send them.
    const dir = join(workDir, 'registration')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'policy.json'),
      JSON.stringify({
        product: 'fuzeservice',
        resources: [{ key: 'Ticket', name: 'Ticket', actions: { read: { name: 'Read' } } }],
        roles: [{ key: 'agent', name: 'Agent', permissions: ['Ticket:read'] }],
      })
    )
    writeFileSync(join(dir, 'billing-profile.json'), JSON.stringify({ productKey: 'service' }))

    await seed('fuzeservice', 'FuzeService')
    const res = await run({ ...ACK, apply: true, registration: dir })
    assert.equal(res.ok, true, res.refusal)
    assert.match(res.steps.join('\n'), /submitted authz policy/)
    assert.match(res.steps.join('\n'), /submitted billing profile/)
  })

  test('a malformed policy.json aborts BEFORE the delete', async () => {
    const dir = join(workDir, 'bad-registration')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'policy.json'), '{ not json')

    await seed('fuzeservice', 'FuzeService')
    const res = await run({ ...ACK, apply: true, registration: dir })
    assert.equal(res.ok, false)
    assert.match(res.refusal, /not valid JSON/)
    assert.equal(
      (await registry.getApp('fuzeservice')).status,
      200,
      'the prefixed app must still be live after any abort'
    )
  })

  test('a bad token fails without deleting anything', async () => {
    await seed('fuzeservice', 'FuzeService')
    const bad = new RegistryClient(registry.base.replace('/api/v1/app-registry', ''), 'wrong', silent)
    const res = await migrate(bad, { from: 'fuzeservice', to: 'service', apply: true, log: silent, ...ACK })
    // Every GET 401s, so the plan reads as "neither registered" — which is precisely why
    // that case is a refusal and not a quiet success.
    assert.equal(res.ok, false)
    assert.equal((await registry.getApp('fuzeservice')).status, 200)
  })

  test('migrating a product whose name is already correct still de-prefixes the slug', async () => {
    // fuzecontact registers as slug `fuzecontact` with name `Contact` — the name half of
    // the convention was already followed, the slug half was not.
    await seed('fuzecontact', 'Contact')
    const res = await migrate(registry, { from: 'fuzecontact', to: 'contact', apply: true, log: silent, ...ACK })
    assert.equal(res.ok, true, res.refusal)
    const now = await registry.getApp('contact')
    assert.equal(now.app.manifest.name, 'Contact')
    assert.equal(now.app.manifest.slug, 'contact')
  })
})
