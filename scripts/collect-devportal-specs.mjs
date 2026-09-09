#!/usr/bin/env node
// collect-devportal-specs.mjs — gathers this repo's own openapi.yaml files
// into services/devportal-service/specs/ so the Dockerfile can bake them
// into the image for devportal-service's bootstrap harvest
// (src/services/bootstrapHarvest.ts). See docs/planning/developers-portal.md
// §4.2 — this is the day-1 seed only; the steady-state path for THIS repo
// (and any family repo in Phase 5) is each repo's own CI POSTing its spec to
// devportal-service's POST /internal/specs.
//
// Run from the repo root: node scripts/collect-devportal-specs.mjs
//
// NOTE: when a new service adds an openapi.yaml, it must be added to the
// SOURCES list below AND to services/devportal-service/Dockerfile's build
// stage (which COPYs each source file into the build context before this
// script runs there). Nothing enforces that pairing yet — same class of gap
// CLAUDE.md's toolchain-floor table calls out for engines/React: reviewed,
// not gated.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// repo: always 'fuzefront' for specs harvested from this checkout.
const SOURCES = [
  { service: 'app-registry-service', specPath: 'services/app-registry-service/openapi.yaml' },
  { service: 'billing-service', specPath: 'services/billing-service/openapi.yaml' },
  { service: 'chat-service', specPath: 'services/chat-service/openapi.yaml' },
  { service: 'config-service', specPath: 'services/config-service/openapi.yaml' },
  { service: 'custom-hostname-api', specPath: 'services/custom-hostname-api/openapi.yaml' },
  { service: 'notification-service', specPath: 'services/notification-service/openapi.yaml' },
  { service: 'payment-service', specPath: 'services/payment-service/openapi.yaml' },
  { service: 'portal-service', specPath: 'services/portal-service/openapi.yaml' },
  { service: 'selection-list-service', specPath: 'services/selection-list-service/openapi.yaml' },
  { service: 'sms-service', specPath: 'services/sms-service/openapi.yaml' },
  { service: 'devportal-service', specPath: 'services/devportal-service/openapi.yaml' },
  { service: 'auth', specPath: 'packages/auth/openapi.yaml' },
  { service: 'security', specPath: 'packages/security/openapi.yaml' },
];

const outDir = join(repoRoot, 'services/devportal-service/specs');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const manifest = [];
let missing = 0;

for (const { service, specPath } of SOURCES) {
  const abs = join(repoRoot, specPath);
  if (!existsSync(abs)) {
    console.warn(`[collect-devportal-specs] SKIP ${specPath} — file not found in this checkout.`);
    missing += 1;
    continue;
  }
  const file = `${service}.yaml`;
  writeFileSync(join(outDir, file), readFileSync(abs, 'utf8'));
  manifest.push({ repo: 'fuzefront', service, specPath, file });
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`[collect-devportal-specs] Collected ${manifest.length} spec(s) into ${outDir}` + (missing ? ` (${missing} missing, skipped)` : ''));
