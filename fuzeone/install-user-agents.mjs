#!/usr/bin/env node
// fuzeone/install-user-agents.mjs — install the FuzeOne engineer "hats" as
// USER-LEVEL Claude agents (~/.claude/agents) so they are available across EVERY
// FuzeOne-family repo on this machine, not just the one you happen to be in.
//
// The hub repo (this checkout) remains the SOURCE OF TRUTH — the agent defs are
// committed under .claude/agents/ so they travel with a fresh clone. This script
// promotes them to the user scope. Run it once per machine (and after pulling new
// agent defs). It is dependency-free (Node >=18 built-ins) and idempotent.
//
// Usage:
//   node fuzeone/install-user-agents.mjs [--check] [--dry-run]
//
//   --check    report drift and exit non-zero if anything differs; writes nothing.
//   --dry-run  print actions without writing.
//
// Destination override: set CLAUDE_HOME to install under $CLAUDE_HOME/agents
// instead of the default ~/.claude/agents.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = resolve(__dirname, '..');                 // the FuzeFront checkout this script lives in
const SRC_DIR = join(HUB_ROOT, '.claude', 'agents');       // canonical, version-controlled agent defs
const CLAUDE_HOME = process.env.CLAUDE_HOME || join(homedir(), '.claude');
const DST_DIR = join(CLAUDE_HOME, 'agents');

const args = { check: false, dryRun: false };
for (const t of process.argv.slice(2)) {
  if (t === '--check') args.check = true;
  else if (t === '--dry-run') args.dryRun = true;
  else { console.error(`unknown arg: ${t}`); process.exit(2); }
}

if (!existsSync(SRC_DIR) || !statSync(SRC_DIR).isDirectory()) {
  console.error(`No agent defs found at ${SRC_DIR}. Run this from a checkout of the hub (izzywdev/FuzeFront).`);
  process.exit(2);
}

// Every *.md except README.md is an agent definition. README stays repo-only (docs).
const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

console.log(`FuzeOne user-agents install  src=${SRC_DIR}  dst=${DST_DIR}`);
let changes = 0;
for (const f of files) {
  const want = readFileSync(join(SRC_DIR, f), 'utf8');
  const destPath = join(DST_DIR, f);
  const have = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
  if (have === want) { console.log(`  unchanged  ${f}`); continue; }
  changes++;
  console.log(`  ${(have == null ? 'create' : 'update').padEnd(9)} ${f}`);
  if (!args.check && !args.dryRun) {
    mkdirSync(DST_DIR, { recursive: true });
    writeFileSync(destPath, want);
  }
}

if (args.check) {
  console.log(`\n${changes ? changes + ' agent(s) would change — drift detected.' : 'In sync.'}`);
  process.exit(changes ? 1 : 0);
}
console.log(`\n${args.dryRun ? '(dry-run) ' : ''}${changes} agent(s) ${args.dryRun ? 'would be' : ''} installed at user level (${DST_DIR}).`);
console.log('These hats are now available in every repo you open with Claude on this machine.');
