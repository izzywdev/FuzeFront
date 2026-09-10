import { describe, expect, it, vi } from 'vitest'
import { incrementalJql, searchJira } from './jira'

const issue = (key: string, updated: string) => ({
  key,
  fields: {
    summary: `Story ${key}`,
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: key }] }] },
    status: { name: 'To Do' },
    issuetype: { name: 'Story' },
    project: { key: 'FQ' },
    updated,
  },
})

describe('incremental Jira synchronization', () => {
  it('adds a stable incremental boundary and replaces caller ordering', () => {
    expect(incrementalJql('project = FQ ORDER BY rank ASC', '2026-09-10T01:02:03.000Z')).toBe(
      '(project = FQ) AND updated >= 1789002123000 ORDER BY updated ASC, key ASC',
    )
  })

  it('walks every page, deduplicates boundary issues, and advances the cursor', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issues: [issue('FQ-2', '2026-09-10T02:00:00.000Z'), issue('FQ-1', '2026-09-10T01:00:00.000Z')],
        isLast: false,
        nextPageToken: 'page-2',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issues: [issue('FQ-2', '2026-09-10T02:00:00.000Z'), issue('FQ-3', '2026-09-10T03:00:00.000Z')],
        isLast: true,
      }), { status: 200 }))

    const result = await searchJira('project = FQ', {
      since: '2026-09-10T00:00:00.000Z',
      baseUrl: 'https://example.atlassian.net',
      email: 'reader@example.com',
      token: 'secret',
      fetchImpl,
    })

    expect(result.requirements.map(item => item.jiraKey)).toEqual(['FQ-1', 'FQ-2', 'FQ-3'])
    expect(result.cursor).toBe('2026-09-10T03:00:00.000Z')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({ nextPageToken: 'page-2' })
  })

  it('advances an empty first sync to its start time', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ issues: [], isLast: true }), { status: 200 }),
    )
    const result = await searchJira('project = FQ', {
      baseUrl: 'https://example.atlassian.net',
      email: 'reader@example.com',
      token: 'secret',
      fetchImpl,
      startedAt: '2026-09-10T04:00:00.000Z',
    })
    expect(result).toEqual({ requirements: [], cursor: '2026-09-10T04:00:00.000Z' })
  })

  it('fails closed when Jira repeats a pagination token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ issues: [], isLast: false, nextPageToken: 'loop' }), { status: 200 }),
    )
    await expect(searchJira('project = FQ', {
      baseUrl: 'https://example.atlassian.net',
      email: 'reader@example.com',
      token: 'secret',
      fetchImpl,
    })).rejects.toThrow('repeated page token')
  })
})
