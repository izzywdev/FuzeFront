import type { Requirement, RequirementSyncResult } from '@fuzequality/contracts'
import { adfToText } from '@fuzequality/core'

type JiraIssue = {
  key: string
  fields: Record<string, unknown> & {
    summary?: string
    description?: unknown
    status?: { name?: string }
    issuetype?: { name?: string }
    project?: { key?: string }
    parent?: { key?: string }
    updated?: string
  }
}

type JiraSearchResponse = {
  issues?: JiraIssue[]
  isLast?: boolean
  nextPageToken?: string
}

type JiraSearchOptions = {
  since?: string
  fetchImpl?: typeof fetch
  baseUrl?: string
  email?: string
  token?: string
  startedAt?: string
}

export function incrementalJql(jql: string, since?: string): string {
  const scope = jql.replace(/\s+ORDER\s+BY\s+.+$/i, '').trim()
  if (!since) return `${scope} ORDER BY updated ASC, key ASC`
  const timestamp = new Date(since)
  if (Number.isNaN(timestamp.getTime())) throw new Error('Jira sync cursor is not a valid timestamp')
  // Jira's search index has eventual-consistency edges. Inclusive comparison
  // intentionally replays the boundary item; database upserts make it safe.
  // An unquoted number is epoch milliseconds in JQL. This preserves the Jira
  // response precision without interpreting the cursor in the service
  // account's configured timezone.
  return `(${scope}) AND updated >= ${timestamp.getTime()} ORDER BY updated ASC, key ASC`
}

function asRequirement(issue: JiraIssue): Requirement {
  return {
    id: `jira:${issue.key}`,
    jiraKey: issue.key,
    issueType: ['Epic', 'Story', 'Task'].includes(issue.fields.issuetype?.name ?? '')
      ? (issue.fields.issuetype!.name as Requirement['issueType'])
      : 'Task',
    parentKey: issue.fields.parent?.key,
    summary: issue.fields.summary ?? issue.key,
    description: adfToText(issue.fields.description),
    status: issue.fields.status?.name ?? 'Unknown',
    project: issue.fields.project?.key ?? 'Unknown',
    updatedAt: issue.fields.updated ?? new Date(0).toISOString(),
  }
}

export async function searchJira(jql: string, options: JiraSearchOptions = {}): Promise<RequirementSyncResult> {
  const baseUrl = options.baseUrl ?? process.env.JIRA_BASE_URL
  const email = options.email ?? process.env.JIRA_EMAIL
  const token = options.token ?? process.env.JIRA_API_TOKEN
  if (!baseUrl || !email || !token) throw new Error('Jira read-only credentials are not configured')
  const fetchImpl = options.fetchImpl ?? fetch
  const requirements = new Map<string, Requirement>()
  const seenTokens = new Set<string>()
  let nextPageToken: string | undefined
  const startedAt = options.startedAt ?? new Date().toISOString()

  do {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jql: incrementalJql(jql, options.since),
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
        fields: ['summary', 'description', 'status', 'issuetype', 'project', 'parent', 'updated'],
      }),
    })
    if (!response.ok) throw new Error(`Jira search returned ${response.status}`)
    const body = (await response.json()) as JiraSearchResponse
    for (const issue of body.issues ?? []) requirements.set(issue.key, asRequirement(issue))
    if (body.isLast !== false || !body.nextPageToken) break
    if (seenTokens.has(body.nextPageToken)) throw new Error('Jira search returned a repeated page token')
    seenTokens.add(body.nextPageToken)
    nextPageToken = body.nextPageToken
  } while (true)

  const ordered = [...requirements.values()].sort((left, right) =>
    Date.parse(left.updatedAt) - Date.parse(right.updatedAt) || left.jiraKey.localeCompare(right.jiraKey)
  )
  return {
    requirements: ordered,
    cursor: ordered.at(-1)?.updatedAt ?? options.since ?? startedAt,
  }
}
