import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  MemberDirectoryFlow,
  createDirectoryClient,
  isDirectoryForbidden,
  type DirectoryMember,
} from '@fuzefront/identity-ui'
import { getActiveAuthToken } from '../lib/accounts'
import { getOrganizations, type Organization } from '../services/api'

const PAGE_SIZE = 25

/**
 * `/organizations/:id/directory` (flag `fuzefront.identity.member-directory`)
 * — the root/portal member directory (design/frames/member-directory/**,
 * flow `member-directory`). Distinct from `OrganizationDetailPage`'s
 * "Members" tab (the small-team, cursor-paged list): "members of root =
 * everyone", so this is a paginated, server-side-searchable USER DIRECTORY
 * against `GET /api/organizations/{id}/directory` (offset-paged;
 * gate-pagination — never fetched-then-filtered client-side).
 *
 * Owns data fetching per the `MemberDirectoryFlow` contract (fully
 * controlled — see that component's doc comment): a 403 renders
 * `DirectoryForbiddenNotice` in place, never a sign-in redirect (only 401
 * re-authenticates, which the shared `api` client already handles globally).
 */
function MemberDirectoryPage() {
  const { id } = useParams<{ id: string }>()

  const [orgName, setOrgName] = useState<string | undefined>(undefined)
  const [members, setMembers] = useState<DirectoryMember[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const client = useRef(createDirectoryClient({ getToken: getActiveAuthToken })).current
  // Guards against an in-flight request from a stale (query, page) resolving
  // after a newer one — only the latest request's result is committed.
  const requestId = useRef(0)

  const load = useCallback(
    async (orgId: string, q: string, p: number) => {
      const myRequestId = ++requestId.current
      setLoading(true)
      setError(null)
      setForbidden(false)
      try {
        const res = await client.listDirectory(orgId, {
          query: q || undefined,
          limit: PAGE_SIZE,
          offset: (p - 1) * PAGE_SIZE,
        })
        if (myRequestId !== requestId.current) return
        setMembers(res.items)
        setPage(res.page)
        setPageSize(res.pageSize)
        setTotal(res.total)
      } catch (err) {
        if (myRequestId !== requestId.current) return
        if (isDirectoryForbidden(err)) {
          setForbidden(true)
        } else {
          setError('Failed to load the member directory')
          console.error('Error loading member directory:', err)
        }
      } finally {
        if (myRequestId === requestId.current) setLoading(false)
      }
    },
    [client]
  )

  useEffect(() => {
    if (id) void load(id, query, page)
  }, [id, query, page, load])

  useEffect(() => {
    let cancelled = false
    if (!id) return
    getOrganizations()
      .then((orgs: Organization[]) => {
        if (!cancelled) setOrgName(orgs.find((o: Organization) => o.id === id)?.name)
      })
      .catch(() => {
        // Non-fatal — the directory still renders without an org-name subtitle.
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return null

  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <MemberDirectoryFlow
        orgName={orgName}
        members={members}
        page={page}
        pageSize={pageSize}
        total={total}
        query={query}
        loading={loading}
        error={error}
        forbidden={forbidden}
        onQueryChange={q => {
          setQuery(q)
          setPage(1)
        }}
        onPageChange={setPage}
        onRetry={() => void load(id, query, page)}
      />
    </div>
  )
}

export default MemberDirectoryPage
