#!/usr/bin/env node
/**
 * Read-only inventory of this repo's open code-scanning alerts.
 *
 * Why this exists: the alerts are not readable from an ordinary session
 * token. `GET /code-scanning/alerts` answers 403 "Resource not accessible by
 * integration" and names the scope it wants in the response header
 * (`X-Accepted-Github-Permissions: security_events=read`), so "how many open
 * alerts are there, and what are they" could not be answered without guessing.
 * Inside Actions the job token can hold that scope, so the question is
 * answerable there — this script is the part that groups the answer.
 *
 * It only reads. Dismissing is codeql-triage.yml's job, deliberately kept
 * separate so an inventory can never quietly close anything.
 *
 * Usage:
 *   node scripts/code-scanning-inventory.mjs            # fetch from the API
 *   node scripts/code-scanning-inventory.mjs alerts.json # group a saved payload
 *
 * Env: GH_TOKEN (or GITHUB_TOKEN), GITHUB_REPOSITORY (owner/repo).
 */
import { readFileSync } from 'node:fs'

const PER_PAGE = 100

async function fetchAllAlerts(repo, token) {
  const out = []
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${repo}/code-scanning/alerts?state=open&per_page=${PER_PAGE}&page=${page}`
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    })
    if (!res.ok) {
      const need = res.headers.get('x-accepted-github-permissions')
      throw new Error(
        `GET ${url} -> HTTP ${res.status}. ${await res.text()}` +
          (need ? `\nThis endpoint requires: ${need}` : '')
      )
    }
    const batch = await res.json()
    out.push(...batch)
    if (batch.length < PER_PAGE) return out
  }
}

/** Group alerts into the three questions worth asking of an inventory. */
export function summarise(alerts) {
  const by = (keyFn) => {
    const m = new Map()
    for (const a of alerts) {
      const k = keyFn(a) ?? '(unknown)'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    // Highest count first, then by name so the output is stable to diff.
    return [...m].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])))
  }
  return {
    total: alerts.length,
    byTool: by((a) => a.tool?.name),
    bySeverity: by((a) => a.rule?.security_severity_level ?? a.rule?.severity),
    byRule: by((a) => a.rule?.id),
    byPath: by((a) => a.most_recent_instance?.location?.path),
  }
}

function table(title, rows, cap = 0) {
  const shown = cap ? rows.slice(0, cap) : rows
  const lines = [`### ${title}`, '', '| key | alerts |', '| --- | --- |']
  for (const [k, v] of shown) lines.push(`| \`${k}\` | ${v} |`)
  if (cap && rows.length > cap) lines.push(`| _…${rows.length - cap} more_ | |`)
  return lines.join('\n') + '\n'
}

export function render(s) {
  return [
    `# Open code-scanning alerts: **${s.total}**`,
    '',
    'Read-only inventory. Nothing was dismissed.',
    '',
    table('By tool (SARIF category source)', s.byTool),
    table('By severity', s.bySeverity),
    table('By rule — group here first; alerts are rarely distinct defects', s.byRule, 40),
    table('By file', s.byPath, 40),
  ].join('\n')
}

// Only run when invoked directly, so the grouping stays unit-testable.
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2]
  let alerts
  if (arg) {
    alerts = JSON.parse(readFileSync(arg, 'utf8'))
  } else {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    const repo = process.env.GITHUB_REPOSITORY
    if (!token || !repo) {
      console.error('Need GH_TOKEN/GITHUB_TOKEN and GITHUB_REPOSITORY, or a JSON file argument.')
      process.exit(2)
    }
    alerts = await fetchAllAlerts(repo, token)
  }
  if (!Array.isArray(alerts)) {
    console.error('Expected a JSON array of alerts.')
    process.exit(2)
  }
  console.log(render(summarise(alerts)))
}
