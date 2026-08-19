import type { Requirement } from '@fuzequality/contracts'
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

export async function searchJira(jql: string): Promise<Requirement[]> {
  const baseUrl = process.env.JIRA_BASE_URL
  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_API_TOKEN
  if (!baseUrl || !email || !token) throw new Error('Jira read-only credentials are not configured')
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'description', 'status', 'issuetype', 'project', 'parent', 'updated'] }),
  })
  if (!response.ok) throw new Error(`Jira search returned ${response.status}`)
  const body = (await response.json()) as { issues?: JiraIssue[] }
  return (body.issues ?? []).map(issue => ({
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
    updatedAt: issue.fields.updated ?? new Date().toISOString(),
  }))
}
