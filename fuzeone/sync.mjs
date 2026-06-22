#!/usr/bin/env node
// fuzeone/sync.mjs — install/update the FuzeOne family standard into a target repo.
// Dependency-free (Node >=18 built-ins only). Idempotent: safe to re-run.
//
// Usage:
//   node fuzeone/sync.mjs [--target DIR] [--scope @fuzefront] [--hub izzywdev/FuzeFront]
//                         [--hub-ref v1] [--repo NAME] [--check] [--dry-run]
//
// --check    report drift (what would change) and exit non-zero if anything differs; writes nothing.
// --dry-run  print the actions without writing.
//
// The script reads canonical files from the HUB checkout it lives in (its repo root),
// substitutes {{REPO}}/{{SCOPE}}/{{HUB}}/{{HUB_REF}}, and writes them into --target.
// Run it from a checkout of the hub (izzywdev/FuzeFront); see fuzeone/README.md for the
// bootstrap-from-hub one-liner that fetches the hub first.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = resolve(__dirname, '..');               // the FuzeFront checkout this script lives in
const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf8'));

function parseArgs(argv) {
  const a = { check: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--check') a.check = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--target') a.target = argv[++i];
    else if (t === '--scope') a.scope = argv[++i];
    else if (t === '--hub') a.hub = argv[++i];
    else if (t === '--hub-ref') a.hubRef = argv[++i];
    else if (t === '--repo') a.repo = argv[++i];
    else { console.error(`unknown arg: ${t}`); process.exit(2); }
  }
  return a;
}

const args = parseArgs(process.argv);
const target = resolve(args.target || process.cwd());
const vars = {
  REPO: args.repo || basename(target),
  SCOPE: args.scope || manifest.vars.SCOPE || '@fuzefront',
  HUB: args.hub || manifest.hub,
  HUB_REF: args.hubRef || manifest.hubRef,
};

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const conditions = {
  'has-helm': () => isDir(join(target, 'deploy', 'helm')),
  'has-infra': () => isDir(join(target, 'deploy', 'terraform')) || isDir(join(target, 'deploy', 'argocd')),
};

const subst = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

function regionMerge(existing, block, marker) {
  const start = `<!-- ${marker}:START -->`;
  const end = `<!-- ${marker}:END -->`;
  const wrapped = `${start}\n${block.trim()}\n${end}`;
  if (existing == null) return wrapped + '\n';
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (re.test(existing)) return existing.replace(re, wrapped);
  return existing.replace(/\s*$/, '') + `\n\n${wrapped}\n`;
}

function desired(entry) {
  const raw = readFileSync(join(HUB_ROOT, entry.src), 'utf8');
  if (entry.mode === 'copy') return raw;
  if (entry.mode === 'template') return subst(raw);
  if (entry.mode === 'region') {
    const destPath = join(target, entry.dest);
    const cur = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
    return regionMerge(cur, subst(raw), entry.marker);
  }
  throw new Error(`unknown mode: ${entry.mode}`);
}

const actions = [];
for (const entry of manifest.managed) {
  if (entry.when && !(conditions[entry.when] && conditions[entry.when]())) {
    actions.push({ dest: entry.dest, status: 'skip', reason: `condition '${entry.when}' not met` });
    continue;
  }
  const destPath = join(target, entry.dest);
  const want = desired(entry);
  const have = existsSync(destPath) ? readFileSync(destPath, 'utf8') : null;
  if (have === want) { actions.push({ dest: entry.dest, status: 'unchanged' }); continue; }
  actions.push({ dest: entry.dest, status: have == null ? 'create' : 'update', want, path: destPath });
}

console.log(`FuzeOne v${manifest.fuzeoneVersion}  target=${target}  repo=${vars.REPO}  scope=${vars.SCOPE}  hub=${vars.HUB}@${vars.HUB_REF}`);
let changes = 0;
for (const a of actions) {
  if (a.status === 'create' || a.status === 'update') {
    changes++;
    console.log(`  ${a.status.toUpperCase().padEnd(9)} ${a.dest}`);
    if (!args.check && !args.dryRun) {
      mkdirSync(dirname(a.path), { recursive: true });
      writeFileSync(a.path, a.want);
    }
  } else {
    console.log(`  ${a.status.padEnd(9)} ${a.dest}${a.reason ? '  (' + a.reason + ')' : ''}`);
  }
}

const secrets = (manifest.requiredSecrets || []).filter(
  (s) => !s.when || (conditions[s.when] && conditions[s.when]())
);
if (secrets.length) {
  console.log('\nRequired repo secrets (set with: gh secret set NAME):');
  for (const s of secrets) console.log(`  - ${s.name}${s.optional ? ' (optional)' : ''} — ${s.why}`);
}

if (args.check) {
  console.log(`\n${changes ? changes + ' file(s) would change — drift detected.' : 'In sync.'}`);
  process.exit(changes ? 1 : 0);
}
console.log(`\n${args.dryRun ? '(dry-run) ' : ''}${changes} file(s) ${args.dryRun ? 'would be' : ''} written.`);
