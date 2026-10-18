#!/usr/bin/env node
/**
 * Sets up Permit.io ABAC resources, condition sets, and policies for plan-tier
 * access control.
 *
 * Background: billing-service's PermitSyncService writes `plan_tier` and
 * `plan_status` attributes onto the tenant subject in Permit whenever a
 * subscription changes (via the FuzeFront Security API proxy). This script
 * defines the POLICY SIDE — the resources, condition sets, and rules that
 * evaluate those attributes when permit.check() is called.
 *
 * Run order:
 *   1. This script (prod-permit-policy-setup.yml) — creates schema + policies
 *   2. prod-billing-stripe-sync.yml mode=apply — syncs plan_tier attributes
 *   3. prod-unleash-ops.yml flags=authz-enabled — flips feature flag ON
 *
 * Usage:
 *   node setup-permit-policies.mjs [--apply] [--env <environment>]
 *
 * Flags:
 *   --apply    Write changes to Permit. Without it, only prints what would change.
 *   --env      Permit environment key (default: production)
 *
 * Secrets (read from env, injected by the cluster runner):
 *   PERMIT_API_KEY   Permit Management API key (project-scoped, read from k8s)
 *   PERMIT_PROJECT   Permit project key (default: fuzefront)
 */

import process from 'node:process';

const DRY_RUN = !process.argv.includes('--apply');
const ENV_KEY = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : (process.env.PERMIT_ENVIRONMENT ?? 'production');
const PROJECT_KEY = process.env.PERMIT_PROJECT ?? 'fuzefront';
const API_KEY = process.env.PERMIT_API_KEY;
const BASE = 'https://api.permit.io/v2';

if (!API_KEY) {
  console.error('PERMIT_API_KEY is required');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function permitGet(path) {
  const r = await fetch(`${BASE}${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function permitPost(path, body) {
  if (DRY_RUN) {
    console.log(`[dry-run] POST ${path}`, JSON.stringify(body, null, 2));
    return { ok: true, dry: true };
  }
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  // 409 = already exists — idempotent
  if (r.status === 409) return { ok: true, existed: true };
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const schemaBase = `/v2/schema/${PROJECT_KEY}/${ENV_KEY}`;

// ── 1. Resource definitions ───────────────────────────────────────────────────
// Each resource corresponds to a product surface gated by plan tier.

const RESOURCES = [
  {
    key: 'api_keys',
    name: 'API Keys',
    description: 'API key management — Growth tier and above',
    actions: { manage: { name: 'Manage' }, read: { name: 'Read' } },
  },
  {
    key: 'custom_domain',
    name: 'Custom Domain',
    description: 'Custom domain configuration — Enterprise tier only',
    actions: { configure: { name: 'Configure' } },
  },
  {
    key: 'sso_config',
    name: 'SSO Configuration',
    description: 'SSO/SAML setup — Growth tier and above',
    actions: { manage: { name: 'Manage' } },
  },
  {
    key: 'module_federation',
    name: 'Module Federation',
    description: 'MF remote hosting — Growth tier and above',
    actions: { manage: { name: 'Manage' } },
  },
  {
    key: 'workspace',
    name: 'Workspace',
    description: 'Workspaces beyond the Starter limit — Growth and above',
    actions: { create: { name: 'Create' }, manage: { name: 'Manage' } },
  },
  {
    key: 'billing_portal',
    name: 'Billing Portal',
    description: 'Billing self-service portal access — all paid tiers',
    actions: { access: { name: 'Access' } },
  },
];

// ── 2. Condition sets — one per tier gate ─────────────────────────────────────

const CONDITION_SETS = [
  {
    key: 'plan_starter_or_above',
    name: 'Plan: Starter or above',
    type: 'userset',
    conditions: {
      allOf: [
        {
          attribute_name: 'plan_tier',
          attribute_type: 'user',
          operator: 'array-contains-any',
          value: ['starter', 'growth', 'enterprise'],
        },
        {
          attribute_name: 'plan_status',
          attribute_type: 'user',
          operator: 'equals',
          value: 'active',
        },
      ],
    },
  },
  {
    key: 'plan_growth_or_above',
    name: 'Plan: Growth or above',
    type: 'userset',
    conditions: {
      allOf: [
        {
          attribute_name: 'plan_tier',
          attribute_type: 'user',
          operator: 'array-contains-any',
          value: ['growth', 'enterprise'],
        },
        {
          attribute_name: 'plan_status',
          attribute_type: 'user',
          operator: 'equals',
          value: 'active',
        },
      ],
    },
  },
  {
    key: 'plan_enterprise',
    name: 'Plan: Enterprise only',
    type: 'userset',
    conditions: {
      allOf: [
        {
          attribute_name: 'plan_tier',
          attribute_type: 'user',
          operator: 'array-contains-any',
          value: ['enterprise'],
        },
        {
          attribute_name: 'plan_status',
          attribute_type: 'user',
          operator: 'equals',
          value: 'active',
        },
      ],
    },
  },
];

// ── 3. Policy rules — resource + action → condition set ───────────────────────

const POLICY_RULES = [
  // Billing portal: any active paid subscriber
  { resource: 'billing_portal', action: 'access', userSet: 'plan_starter_or_above' },
  // Additional workspaces: Growth+
  { resource: 'workspace', action: 'create', userSet: 'plan_growth_or_above' },
  { resource: 'workspace', action: 'manage', userSet: 'plan_growth_or_above' },
  // API keys: Growth+
  { resource: 'api_keys', action: 'read', userSet: 'plan_growth_or_above' },
  { resource: 'api_keys', action: 'manage', userSet: 'plan_growth_or_above' },
  // SSO config: Growth+
  { resource: 'sso_config', action: 'manage', userSet: 'plan_growth_or_above' },
  // Module Federation hosting: Growth+
  { resource: 'module_federation', action: 'manage', userSet: 'plan_growth_or_above' },
  // Custom domain: Enterprise only
  { resource: 'custom_domain', action: 'configure', userSet: 'plan_enterprise' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

let errors = 0;

async function step(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    errors++;
  }
}

console.log(`\nPermit ABAC policy setup — project=${PROJECT_KEY} env=${ENV_KEY} mode=${DRY_RUN ? 'dry-run' : 'APPLY'}\n`);

console.log('Verifying Permit credentials...');
await step('credentials valid', () => permitGet(`/v2/api-key/scope`));

console.log('\nCreating resources...');
for (const resource of RESOURCES) {
  await step(`resource: ${resource.key}`, () =>
    permitPost(`${schemaBase}/resources`, resource),
  );
}

console.log('\nCreating condition sets...');
for (const cs of CONDITION_SETS) {
  await step(`condition-set: ${cs.key}`, () =>
    permitPost(`${schemaBase}/condition_sets`, cs),
  );
}

console.log('\nCreating policy rules...');
for (const rule of POLICY_RULES) {
  await step(`policy: ${rule.resource}:${rule.action} → ${rule.userSet}`, () =>
    permitPost(`${schemaBase}/condition_set_rules`, {
      user_set: rule.userSet,
      resource_set: rule.resource,
      permission: `${rule.resource}:${rule.action}`,
    }),
  );
}

console.log(`\n${'─'.repeat(60)}`);
if (DRY_RUN) {
  console.log('Dry-run complete. Re-run with --apply to write changes.');
} else if (errors > 0) {
  console.error(`Done with ${errors} error(s). Review above and re-run.`);
  process.exit(1);
} else {
  console.log('All policies applied successfully.');
}
