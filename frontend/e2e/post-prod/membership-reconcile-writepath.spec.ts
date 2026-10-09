import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'

/**
 * POST-PRODUCTION write-path smoke — proves the membership → ReBAC reconcile
 * (#1284) works END-TO-END on the LIVE platform: a real membership change emits
 * identity.membership.added, provisioning-service consumes it and POSTs to
 * security /internal/membership-sync, and the user ends up with a Permit role
 * on the org tenant.
 *
 * Unlike the other post-prod specs this one MUTATES prod, so it is OPT-IN:
 * it runs only when POST_PROD_ALLOW_WRITES is set (and POST_PROD_PASSWORD is
 * available for the base auth surface). Off by default so the automatic
 * post-deploy job never creates/deletes prod rows unless an operator asked.
 *
 * Self-contained + self-cleaning:
 *   1. Create a UNIQUE throwaway user (random email+password) via the public
 *      signup API — NOT the shared `postprod-smoke` synthetic, whose deletion
 *      would break the other specs that reuse it.
 *   2. Create an org as that user → emits identity.org.created +
 *      identity.membership.added(owner).
 *   3. Poll GET /api/v1/security/authz/permissions?tenant=<org> until the
 *      caller has a NON-EMPTY permission set on the new org tenant — the Permit
 *      reflection of the reconcile. Empty-before / non-empty-after is exactly
 *      the event→provisioning→Permit pipeline this proves. Eventual-consistency
 *      is real (Kafka → consumer → PDP), so this polls with backoff.
 *   4. ALWAYS clean up in `finally`: soft-delete the org (owner-only;
 *      emits identity.org.deleted cascade) and deactivate the throwaway user
 *      (DELETE /api/me). Cleanup is best-effort and logged — a verification
 *      failure never leaves an orphan behind.
 *
 * Reconcile is async; the whole flow is bounded well under the config's 90s
 * test timeout.
 */

const WRITE_ALLOWED = Boolean(process.env.POST_PROD_ALLOW_WRITES)
const SECURITY = '/api/v1/security'

/** A random password that satisfies a typical complexity policy. Throwaway. */
function throwawayPassword(): string {
  return `Aa1!${randomUUID()}${randomUUID().slice(0, 8).toUpperCase()}`
}

interface Session {
  token: string
  email: string
}

/** Sign a fresh, unique throwaway account up and in; returns its bearer token. */
async function provisionThrowaway(request: APIRequestContext): Promise<Session> {
  const email = `postprod-writepath-${Date.now()}-${randomUUID().slice(0, 8)}@fuzefront.com`
  const password = throwawayPassword()

  const signup = await request.post(`${SECURITY}/signup`, {
    data: { email, password, firstName: 'Post-prod', lastName: 'WritePath' },
  })
  // 201 created, or 409 if a prior run somehow used this exact address (random,
  // so practically never) — either way we then sign in.
  expect(
    [200, 201, 409].includes(signup.status()),
    `signup for ${email} -> ${signup.status()} (expected 201/200; 409=race): ${await signup.text()}`
  ).toBe(true)

  const session = await request.post(`${SECURITY}/session`, {
    data: { email, password },
  })
  expect(
    session.status(),
    `POST ${SECURITY}/session -> ${session.status()} for the throwaway (sign-in broken?)`
  ).toBe(200)
  const body = (await session.json()) as { token?: string }
  expect(body.token, 'no token returned for the throwaway session').toBeTruthy()
  return { token: body.token!, email }
}

function orgIdFrom(body: unknown): string | undefined {
  const b = body as Record<string, any>
  return b?.id ?? b?.organization?.id ?? b?.data?.id
}

test.describe('Membership → ReBAC reconcile (#1284) — live post-prod WRITE path', () => {
  test('creating an org reconciles the owner into a Permit role on the org tenant', async ({
    request,
  }, testInfo) => {
    test.skip(
      !WRITE_ALLOWED,
      'POST_PROD_ALLOW_WRITES not set — this smoke MUTATES prod (creates then deletes an org + a ' +
        'throwaway user). Opt in by setting POST_PROD_ALLOW_WRITES=1 for a deliberate write-path run. ' +
        'This is an intentional opt-out, not missing coverage of a read assertion.'
    )

    const { token, email } = await provisionThrowaway(request)
    testInfo.annotations.push({ type: 'throwaway', description: email })
    const auth = { Authorization: `Bearer ${token}` }

    let orgId: string | undefined

    try {
      // 2. Create an org → identity.org.created + identity.membership.added(owner).
      const slug = `pp-writepath-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
      const createResp = await request.post('/api/organizations', {
        headers: auth,
        data: { name: `Post-prod WritePath ${slug}`, slug },
      })
      expect(
        [200, 201].includes(createResp.status()),
        `POST /api/organizations -> ${createResp.status()}: ${await createResp.text()}`
      ).toBe(true)
      orgId = orgIdFrom(await createResp.json())
      expect(orgId, 'org create returned no id').toBeTruthy()

      // 3. Poll the Permit reflection until the reconcile lands. Empty before,
      //    non-empty after = the event→provisioning→Permit pipeline worked.
      const deadline = Date.now() + 60_000
      let permissions: unknown[] = []
      let lastStatus = 0
      while (Date.now() < deadline) {
        const permResp = await request.get(`${SECURITY}/authz/permissions`, {
          headers: auth,
          params: { tenant: orgId! },
        })
        lastStatus = permResp.status()
        if (lastStatus === 200) {
          const pb = (await permResp.json()) as { permissions?: unknown[] }
          permissions = Array.isArray(pb.permissions) ? pb.permissions : []
          if (permissions.length > 0) break
        }
        await new Promise(r => setTimeout(r, 3_000))
      }
      expect(
        permissions.length,
        `the throwaway owner has no Permit permissions on org ${orgId} after 60s ` +
          `(last GET ${SECURITY}/authz/permissions -> ${lastStatus}). The membership→ReBAC ` +
          'reconcile (identity.membership.added → provisioning-service → /internal/membership-sync → ' +
          'assignOrganizationRole) did not land on the live deploy.'
      ).toBeGreaterThan(0)

      // Belt-and-braces: an explicit decision for an owner/admin action on the
      // tenant must now ALLOW. Fail-closed endpoint, so allow:true is a real
      // positive, not a swallowed error.
      const checkResp = await request.post(`${SECURITY}/authz/check`, {
        headers: auth,
        data: { tenant: orgId!, resource: { type: 'Organization' }, action: 'read' },
      })
      expect(checkResp.status(), `POST ${SECURITY}/authz/check -> ${checkResp.status()}`).toBe(200)
      const decision = (await checkResp.json()) as { allow?: boolean }
      expect(
        decision.allow,
        `authz/check denied the owner a basic read on their own org ${orgId} — the Permit role ` +
          'assignment from the reconcile is not effective.'
      ).toBe(true)
    } finally {
      // 4. ALWAYS clean up — a failed assertion must not leave prod rows behind.
      if (orgId) {
        const del = await request
          .delete(`/api/organizations/${orgId}`, { headers: auth })
          .catch(e => ({ status: () => -1, text: async () => String(e) }) as any)
        testInfo.annotations.push({
          type: 'cleanup',
          description: `DELETE /api/organizations/${orgId} -> ${del.status()}`,
        })
      }
      const delMe = await request
        .delete('/api/me', { headers: auth })
        .catch(e => ({ status: () => -1, text: async () => String(e) }) as any)
      testInfo.annotations.push({
        type: 'cleanup',
        description: `DELETE /api/me (${email}) -> ${delMe.status()}`,
      })
    }
  })
})
