#!/usr/bin/env node
/**
 * Sets up Permit.io ABAC resources, resource sets, condition sets, and policy
 * rules for plan-tier access control.
 *
 * Background: billing-service's PermitSyncService writes `plan_tier` and
 * `plan_status` attributes onto the subject in Permit whenever a subscription
 * changes (via the FuzeFront Security API proxy). This script defines the
 * POLICY SIDE — the resources, condition sets, and rules that evaluate those
 * attributes when permit.check() is called.
 *
 * Run order:
 *   1. This script (prod-permit-policy-setup.yml) — creates schema + policies
 *   2. prod-billing-stripe-sync.yml mode=apply — syncs plan_tier attributes
 *   3. Helm deploy with FUZEFRONT_BILLING_AUTHZ_ENABLED=true — activates authz
 *
 * Usage:
 *   node setup-permit-policies.mjs [--apply]
 *
 * Flags:
 *   --apply    Write changes to Permit. Without it, only prints what would change.
 *
 * Secrets (read from env, injected by the cluster runner):
 *   PERMIT_API_KEY      Permit Management API key (from k8s fuzefront-secrets)
 *   PERMIT_PROJECT      Permit project key (default: fuzefront)
 *   PERMIT_ENVIRONMENT  Permit environment key (default: production)
 */

import process from 'node:process';

const DRY_RUN = !process.argv.includes('--apply');
const ENV_KEY = process.env.PERMIT_ENVIRONMENT ?? 'production';
const PROJECT_KEY = process.env.PERMIT_PROJECT ?? 'fuzefront';
const API_KEY = process.env.PERMIT_API_KEY;
const BASE = 'https://api.permit.io';

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
  // 409 = already exists — idempotent (caller may need to update; see reconcile note)
  if (r.status === 409) return { ok: true, existed: true };
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

const schemaBase = `/v2/schema/${PROJECT_KEY}/${ENV_KEY}`;
const factsBase  = `/v2/facts/${PROJECT_KEY}/${ENV_KEY}`;

// ── 1. Resource definitions ───────────────────────────────────────────────────

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

// ── 2. Resource sets — one per resource, matching all instances ───────────────
// Required by the set_rules API; empty conditions = any instance of the resource.

const RESOURCE_SETS = RESOURCES.map((r) => ({
  key: `${r.key}_all`,
  name: `${r.name} — all instances`,
  resource: r.key,
  conditions: {},
}));

// ── 3. Condition sets (user sets) — one per tier gate ─────────────────────────
// Permit attribute-first format: {"user.attr": {"op": value}}
// Entitled statuses: active + trialing (no-card trials) + past_due (grace period).

const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'];

const CONDITION_SETS = [
  {
    key: 'plan_starter_or_above',
    name: 'Plan: Starter or above',
    type: 'userset',
    conditions: {
      allOf: [
        { 'user.plan_tier': { in: ['starter', 'growth', 'enterprise'] } },
        { 'user.plan_status': { in: ENTITLED_STATUSES } },
      ],
    },
  },
  {
    key: 'plan_growth_or_above',
    name: 'Plan: Growth or above',
    type: 'userset',
    conditions: {
      allOf: [
        { 'user.plan_tier': { in: ['growth', 'enterprise'] } },
        { 'user.plan_status': { in: ENTITLED_STATUSES } },
      ],
    },
  },
  {
    key: 'plan_enterprise',
    name: 'Plan: Enterprise only',
    type: 'userset',
    conditions: {
      allOf: [
        { 'user.plan_tier': { in: ['enterprise'] } },
        { 'user.plan_status': { in: ENTITLED_STATUSES } },
      ],
    },
  },
];

// ── 4. Policy rules — resource set + action → user set ───────────────────────
// Posted to /v2/facts/{project}/{env}/set_rules (not the schema endpoint).

const POLICY_RULES = [
  // Billing portal: any active paid subscriber
  { resourceSet: 'billing_portal_all', action: 'access', userSet: 'plan_starter_or_above' },
  // Additional workspaces: Growth+
  { resourceSet: 'workspace_all', action: 'create', userSet: 'plan_growth_or_above' },
  { resourceSet: 'workspace_all', action: 'manage', userSet: 'plan_growth_or_above' },
  // API keys: Growth+
  { resourceSet: 'api_keys_all', action: 'read', userSet: 'plan_growth_or_above' },
  { resourceSet: 'api_keys_all', action: 'manage', userSet: 'plan_growth_or_above' },
  // SSO config: Growth+
  { resourceSet: 'sso_config_all', action: 'manage', userSet: 'plan_growth_or_above' },
  // Module Federation hosting: Growth+
  { resourceSet: 'module_federation_all', action: 'manage', userSet: 'plan_growth_or_above' },
  // Custom domain: Enterprise only
  { resourceSet: 'custom_domain_all', action: 'configure', userSet: 'plan_enterprise' },
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
if (DRY_RUN) {
  console.log('[dry-run] GET /v2/api-key/scope (skipping in dry-run)');
} else {
  await step('credentials valid', () => permitGet('/v2/api-key/scope'));
  if (errors > 0) {
    console.error('\nCredential check failed — aborting.');
    process.exit(1);
  }
}

console.log('\nCreating resources...');
for (const resource of RESOURCES) {
  await step(`resource: ${resource.key}`, () =>
    permitPost(`${schemaBase}/resources`, resource),
  );
}

console.log('\nCreating resource sets...');
for (const rs of RESOURCE_SETS) {
  await step(`resource-set: ${rs.key}`, () =>
    permitPost(`${schemaBase}/resourcesets`, rs),
  );
}

console.log('\nCreating condition sets (user sets)...');
for (const cs of CONDITION_SETS) {
  await step(`condition-set: ${cs.key}`, () =>
    permitPost(`${schemaBase}/condition_sets`, cs),
  );
}

console.log('\nCreating policy rules...');
for (const rule of POLICY_RULES) {
  await step(`policy: ${rule.resourceSet}:${rule.action} → ${rule.userSet}`, () =>
    permitPost(`${factsBase}/set_rules`, {
      user_set: rule.userSet,
      resource_set: rule.resourceSet,
      permission: rule.action,
    }),
  );
}

console.log(`\n${'─'.repeat(60)}`);
if (DRY_RUN) {
  if (errors > 0) {
    console.error(`Dry-run completed with ${errors} error(s). Review above before running with --apply.`);
    process.exit(1);
  }
  console.log('Dry-run complete. Re-run with --apply to write changes.');
} else if (errors > 0) {
  console.error(`Done with ${errors} error(s). Review above and re-run.`);
  process.exit(1);
} else {
  console.log('All policies applied successfully.');
}
