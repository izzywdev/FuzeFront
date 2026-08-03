// Tests for bin/validate-policy.mjs — the check a product runs in its OWN CI so a
// policy that the platform would reject (or would accept and silently grant nothing)
// fails in the repo that owns the file, not in an init-container log at deploy time.
//
// Run: node --test tests/validate-policy.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validatePolicyDocument, policyWarnings } from '../bin/validate-policy.mjs'

const KIT = dirname(dirname(fileURLToPath(import.meta.url)))

const valid = () => ({
  name: 'FuzeService',
  resources: [
    {
      key: 'Ticket',
      name: 'Ticket',
      actions: { read: { name: 'Read' }, transition: { name: 'Change status' } },
    },
  ],
  roles: [
    { key: 'agent', name: 'Service Agent', permissions: ['Ticket:read', 'Ticket:transition'] },
  ],
})

const errorsFor = (mutate, slug) => {
  const doc = valid()
  mutate(doc)
  return validatePolicyDocument(doc, slug)
}

test('accepts a well-formed policy', () => {
  assert.deepEqual(validatePolicyDocument(valid()), [])
})

test('accepts the kit template — the thing every product copies', () => {
  const template = JSON.parse(readFileSync(join(KIT, 'templates', 'policy.json'), 'utf8'))
  assert.deepEqual(validatePolicyDocument(template), [])
})

test('rejects an underscore in a resource key — it is the namespace separator', () => {
  const errs = errorsFor(d => {
    d.resources[0].key = 'Vault_Asset'
  })
  assert.ok(errs.some(e => e.includes('Vault_Asset')), errs.join('\n'))
})

test('rejects an underscore in a role key', () => {
  const errs = errorsFor(d => {
    d.roles[0].key = 'service_agent'
  })
  assert.ok(errs.some(e => e.includes('service_agent')), errs.join('\n'))
})

test('accepts a hyphenated key — every shipped product policy uses them', () => {
  assert.deepEqual(
    errorsFor(d => {
      d.roles[0].key = 'release-manager'
    }),
    []
  )
})

test('rejects an unknown top-level key — the platform schema is strict', () => {
  // Real case: fuzesocial shipped a `$comment` key. The Zod schema is .strict() and
  // the OpenAPI is additionalProperties:false, so the whole PUT would 400 — but the
  // product would only have found out from an init-container log at deploy time.
  const errs = errorsFor(d => {
    d.$comment = 'explaining myself'
  })
  assert.ok(errs.some(e => e.includes('$comment')), errs.join('\n'))
})

test('rejects a permission whose resource is not declared here', () => {
  const errs = errorsFor(d => {
    d.roles[0].permissions.push('Queue:read')
  })
  assert.ok(errs.some(e => e.includes('Queue')), errs.join('\n'))
})

test('rejects a permission whose action the resource does not declare', () => {
  // The silent class: Permit happily creates the role, it just never grants.
  const errs = errorsFor(d => {
    d.roles[0].permissions.push('Ticket:delete')
  })
  assert.ok(errs.some(e => e.includes('no action "delete"')), errs.join('\n'))
})

test('rejects a malformed permission string', () => {
  const errs = errorsFor(d => {
    d.roles[0].permissions.push('Ticket')
  })
  assert.equal(errs.length, 1)
})

test('rejects duplicate resource and role keys', () => {
  assert.ok(
    errorsFor(d => {
      d.resources.push({ ...d.resources[0] })
    }).some(e => e.includes('duplicate'))
  )
  assert.ok(
    errorsFor(d => {
      d.roles.push({ ...d.roles[0] })
    }).some(e => e.includes('duplicate'))
  )
})

test('rejects a resource with no actions', () => {
  const errs = errorsFor(d => {
    d.resources[0].actions = {}
  })
  assert.ok(errs.some(e => e.includes('no actions')), errs.join('\n'))
})

test('rejects a `product` that disagrees with the manifest slug', () => {
  // The platform 400s this: it would otherwise let a caller with write access to
  // app A install a policy namespaced to app B.
  const errs = errorsFor(d => {
    d.product = 'fuzesales'
  }, 'fuzeservice')
  assert.ok(errs.some(e => e.includes('disagrees')), errs.join('\n'))
})

test('accepts a `product` that agrees with the manifest slug', () => {
  assert.deepEqual(
    errorsFor(d => {
      d.product = 'fuzeservice'
    }, 'fuzeservice'),
    []
  )
})

test('warns about an action no role grants — valid, but almost always a mistake', () => {
  const doc = valid()
  doc.resources[0].actions.delete = { name: 'Delete' }
  assert.deepEqual(validatePolicyDocument(doc), [])
  assert.ok(policyWarnings(doc).some(w => w.includes('delete')), JSON.stringify(policyWarnings(doc)))
})

test('warns about a resource no role can touch at all', () => {
  const doc = valid()
  doc.resources.push({ key: 'Queue', name: 'Queue', actions: { read: { name: 'Read' } } })
  assert.deepEqual(validatePolicyDocument(doc), [])
  assert.ok(policyWarnings(doc).some(w => w.includes('Queue')))
})

test('rejects non-object input rather than throwing', () => {
  for (const bad of [null, [], 'nope', 42]) {
    assert.ok(validatePolicyDocument(bad).length > 0)
  }
})
