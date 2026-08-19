// The consumer registration path must never reach the database with a synthetic
// user id.
//
// WHAT THIS GUARDS, AND WHY IT IS WORTH A TEST OF ITS OWN
//
// Consumer products (FuzeHub, FuzeSales, …) register from a Kubernetes init
// container running register.sh. They have no human and no OIDC session, so they
// present the pre-shared CONSUMER_REGISTRATION_SECRET; consumer-auth attaches a
// SYNTHETIC user whose id is the string 'consumer-registration'.
//
// That id is not a UUID. `organization_memberships.user_id` is `table.uuid(...)`
// (backend/src/migrations/005_create_organization_memberships_table.ts). So
// resolveCaller's `getMemberOrgIds(user.id)` produced
//
//   select "organization_id" from "organization_memberships"
//     where "user_id" = 'consumer-registration'
//
// which Postgres rejects with `invalid input syntax for type uuid`. The routes'
// try/catch turned that into `500 {"error":"internal_error"}`.
//
// The blast radius is the whole consumer registration path, not one product:
// GET /apps/:slug is the FIRST call register.sh makes, so every consumer 500'd
// immediately, retried five times, then hard-failed by design — leaving the pod
// in Init:CrashLoopBackOff and the product missing from the portal menu.
// Measured in prod on FuzeHub: 1619 restarts over 6d11h, every one of them
//   GET /api/v1/app-registry/apps/fuzehub -> 500 {"message":"Failed to get app"}
//
// It is worth a regression test because of how it presents: the crash-looping
// pod belongs to the CONSUMER, so it reads as the consumer's bug, while the
// fault is here in the platform. Nothing on the FuzeFront side went red.
//
// The assertion is on the QUERY, not just the status code. A 200 could be
// reached while still issuing a doomed query on some other path, and it is the
// query that is fatal.
import express from 'express'
import request from 'supertest'

const CONSUMER_SECRET = 'test-consumer-secret'

// Records every table the route layer touches, so the test can assert that the
// consumer path performs NO membership lookup at all.
const queriedTables: string[] = []

jest.mock('../src/config/database', () => ({
  db: jest.fn((table: string) => {
    queriedTables.push(table)
    // Mirror the real failure: a non-UUID against a uuid column throws. Without
    // the fix the route hits this and 500s, exactly as prod did.
    const chain: any = {
      where: () => chain,
      select: () =>
        Promise.reject(
          new Error(
            'invalid input syntax for type uuid: "consumer-registration"'
          )
        ),
    }
    return chain
  }),
}))

// Stub ONLY the data access. `canRead` is the real implementation on purpose:
// it is the visibility rule this route depends on, and replacing it would make
// the status assertions meaningless. (An earlier version of this mock omitted
// it entirely, which produced a 500 from `canRead is not a function` — a
// self-inflicted failure that looked exactly like the bug under test. Hence
// also the query-level assertion below, which that artefact could not fake.)
jest.mock('../src/app-registry/service', () => ({
  ...jest.requireActual('../src/app-registry/service'),
  appRegistryService: {
    findBySlug: jest.fn().mockResolvedValue({
      slug: 'fuzehub',
      organizationId: null,
      status: 'activated',
      manifest: { name: 'Hub' },
    }),
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appRegistryRouter = require('../src/routes/app-registry').default

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/app-registry', appRegistryRouter)
  return app
}

const asConsumer = (r: request.Test) =>
  r.set('Authorization', `Bearer ${CONSUMER_SECRET}`)

describe('consumer registration caller', () => {
  const originalSecret = process.env.CONSUMER_REGISTRATION_SECRET

  beforeAll(() => {
    process.env.CONSUMER_REGISTRATION_SECRET = CONSUMER_SECRET
  })
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CONSUMER_REGISTRATION_SECRET
    else process.env.CONSUMER_REGISTRATION_SECRET = originalSecret
  })
  beforeEach(() => {
    queriedTables.length = 0
  })

  it('GET /apps/:slug does not 500 for the consumer — the prod FuzeHub failure', async () => {
    const res = await asConsumer(
      request(buildApp()).get('/api/v1/app-registry/apps/fuzehub')
    )

    // The exact response prod returned, and the reason FuzeHub CrashLooped.
    expect(res.status).not.toBe(500)
    expect(res.body).not.toMatchObject({ error: 'internal_error' })
  })

  it('never queries organization_memberships for a service caller', async () => {
    // The root cause, asserted directly. A service belongs to no organization,
    // so the lookup is not merely unsafe — it is meaningless.
    await asConsumer(request(buildApp()).get('/api/v1/app-registry/apps/fuzehub'))

    expect(queriedTables).not.toContain('organization_memberships')
  })

  it('still resolves the consumer as a platform admin', async () => {
    // The fix must not quietly cost the consumer its authority: `admin` comes
    // from the synthetic user's roles, and bypassing Permit for service
    // registration depends on it. Without this, returning an unprivileged caller
    // would also make the 500 go away — and break registration a different way.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveCaller } = require('../src/app-registry/caller')
    const caller = await resolveCaller({
      id: 'consumer-registration',
      roles: ['admin'],
    })

    expect(caller.isPlatformAdmin).toBe(true)
    expect(caller.organizationIds).toEqual([])
    expect(queriedTables).not.toContain('organization_memberships')
  })

  it('a REAL user id still goes to the database', async () => {
    // The guard must be scoped to the synthetic service id, not a blanket skip.
    // If it widened to every caller, org scoping — and with it the BOLA
    // protection on these routes — would silently stop working.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveCaller } = require('../src/app-registry/caller')
    await expect(
      resolveCaller({
        id: '11111111-2222-3333-4444-555555555555',
        roles: ['user'],
      })
    ).rejects.toThrow(/invalid input syntax for type uuid|uuid/)

    expect(queriedTables).toContain('organization_memberships')
  })
})
