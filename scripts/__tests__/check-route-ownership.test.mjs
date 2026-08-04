/**
 * Tests for the route-ownership gate.
 *
 * The most important case here is `catches the original regression`: it feeds
 * the gate the real prod ingress shape plus the OLD (buggy) arrangement — the
 * install router mounted on fuzefront-backend — and asserts the gate reports the
 * mismatch. A gate that has never been shown to fail on the bug it was written
 * for is not evidence of anything.
 *
 * Run with:  node --test scripts/__tests__/check-route-ownership.test.mjs
 * (node:test, so this needs no jest wiring for a repo-level script.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractIngressRoutes, resolveOwner, isMounted, appHost } from '../check-route-ownership.mjs'

// The shape `helm template` emits for the main ingress, trimmed to the rules
// that matter. Path/service pairs are copied from
// deploy/helm/fuzefront/templates/ingress.yaml.
const RENDERED = `
apiVersion: v1
kind: Service
metadata:
  name: not-an-ingress
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fuzefront
spec:
  rules:
  - host: app.fuzefront.com
    http:
      paths:
      - path: /api/v1/security
        pathType: Prefix
        backend:
          service:
            name: fuzefront-security
            port:
              number: 3002
      - path: /api/organizations
        pathType: Prefix
        backend:
          service:
            name: fuzefront-security
            port:
              number: 3002
      - path: /api/apps
        pathType: Prefix
        backend:
          service:
            name: fuzefront-applications
            port:
              number: 3003
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: fuzefront-backend
            port:
              number: 3001
      - path: /
        pathType: Prefix
        backend:
          service:
            name: fuzefront-frontend
            port:
              number: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fuzefront-authentik-idp
spec:
  rules:
  - host: auth.fuzefront.com
    http:
      paths:
      - path: /api/v3
        pathType: Prefix
        backend:
          service:
            name: authentik-server
            port:
              number: 9000
      - path: /api/apps/installed
        pathType: Prefix
        backend:
          service:
            name: authentik-server
            port:
              number: 9000
`

test('extracts only Ingress path -> service pairs, with host and ingress name', () => {
  const routes = extractIngressRoutes(RENDERED)
  assert.equal(routes.length, 7, 'the non-Ingress Service document must be ignored')
  assert.deepEqual(routes.find(r => r.path === '/api/apps'), {
    path: '/api/apps',
    service: 'fuzefront-applications',
    host: 'app.fuzefront.com',
    ingress: 'fuzefront',
  })
})

test('the app host is taken from the main fuzefront ingress', () => {
  assert.equal(appHost(extractIngressRoutes(RENDERED)), 'app.fuzefront.com')
})

test('another host cannot steal a path, even with a longer prefix', () => {
  const routes = extractIngressRoutes(RENDERED)
  // The Authentik ingress publishes /api/v3 and (contrived here) an exact
  // /api/apps/installed on ITS OWN host. Ignoring hosts would let it win the
  // longest-prefix contest and report authentik-server as the owner — a
  // confident, wrong answer that would send someone chasing a phantom.
  assert.equal(resolveOwner('/api/apps/installed', routes).service, 'fuzefront-applications')
  assert.equal(resolveOwner('/api/v3/core/applications', routes).service, 'fuzefront-backend')
})

test('resolves by LONGEST prefix, exactly as the nginx ingress does', () => {
  const routes = extractIngressRoutes(RENDERED)

  // The heart of the bug: /api/apps/... is NOT served by the /api rule.
  assert.equal(resolveOwner('/api/apps/installed', routes).service, 'fuzefront-applications')
  assert.equal(resolveOwner('/api/apps/abc-123/install', routes).service, 'fuzefront-applications')
  assert.equal(resolveOwner('/api/apps', routes).service, 'fuzefront-applications')

  // Siblings still fall through to the catch-all.
  assert.equal(resolveOwner('/api/v1/notifications/unread-count', routes).service, 'fuzefront-backend')
  assert.equal(resolveOwner('/api/health', routes).service, 'fuzefront-backend')
  assert.equal(resolveOwner('/api/organizations', routes).service, 'fuzefront-security')
})

test('does not treat /api/appsomething as a match for /api/apps', () => {
  const routes = extractIngressRoutes(RENDERED)
  // Prefix matching must respect segment boundaries, or a gate would report the
  // wrong owner for an unrelated path and send someone chasing a phantom.
  assert.equal(resolveOwner('/api/appsomething', routes).service, 'fuzefront-backend')
})

test('catches the original regression: install routes owned by applications, implemented on backend', () => {
  const routes = extractIngressRoutes(RENDERED)

  // This is the pre-fix reality that shipped to production.
  const buggyContractEntry = {
    path: '/api/apps/installed',
    servedBy: 'fuzefront-backend', // what the implementation assumed
  }

  const owner = resolveOwner(buggyContractEntry.path, routes)
  assert.notEqual(
    owner.service,
    buggyContractEntry.servedBy,
    'the gate must flag a route implemented on a service that does not own its prefix'
  )
  assert.equal(owner.service, 'fuzefront-applications')
})

test('mount check: reports a router that exists but is never app.use()d', () => {
  // The real, current arrangement must pass.
  const good = isMounted(
    'backend/applications/src/index.ts',
    'backend/applications/src/routes/app-installations.ts'
  )
  assert.equal(good.ok, true, good.reason)

  // And the backend must NOT still be mounting it — that is the state the gate
  // exists to prevent regressing to.
  const stale = isMounted('backend/src/index.ts', 'backend/applications/src/routes/app-installations.ts')
  assert.equal(stale.ok, false)
})
