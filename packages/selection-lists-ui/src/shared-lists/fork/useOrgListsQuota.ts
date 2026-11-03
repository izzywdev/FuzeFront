/**
 * The dialog's optional quota preview: "37 → 38 of 100" organization lists.
 *
 * `GET /v1/selection-lists/quota` needs `read_quota`, which a plain editor does
 * not hold — so ANY failure means "no preview" (the block is absent, never an
 * error). The wire shape is the client's `SelectionListQuotaStatus`
 * (`{ organization_id, quotas: [{ scope, applies_to, limit, current }] }`).
 */

import type { SelectionListQuotaStatus } from '@fuzeone/selection-list-client'
import { useEffect, useState } from 'react'
import { SELECTION_LISTS_API_BASE, request } from '../../api'

export interface OrgListsQuota {
  limit: number
  current: number
}

/** The `org_lists` entry of a quota answer, or `null` when it is not a usable number pair. */
export function orgListsQuotaOf(status: unknown): OrgListsQuota | null {
  const quotas = (status as Partial<SelectionListQuotaStatus> | null)?.quotas
  if (!Array.isArray(quotas)) return null
  const entry = quotas.find(q => q?.scope === 'org_lists')
  if (
    !entry ||
    typeof entry.limit !== 'number' ||
    typeof entry.current !== 'number'
  )
    return null
  return { limit: entry.limit, current: entry.current }
}

export function useOrgListsQuota(): OrgListsQuota | null {
  const [quota, setQuota] = useState<OrgListsQuota | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    request<SelectionListQuotaStatus>(`${SELECTION_LISTS_API_BASE}/quota`, {
      signal: controller.signal,
    }).then(
      ({ data }) => {
        if (!controller.signal.aborted) setQuota(orgListsQuotaOf(data))
      },
      () => {
        // 403 (no read_quota), 5xx, network, abort: no preview.
      }
    )
    return () => controller.abort()
  }, [])
  return quota
}
