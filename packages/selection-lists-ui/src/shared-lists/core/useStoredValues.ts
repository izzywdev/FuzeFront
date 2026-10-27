/**
 * useStoredValues — resolve the item ids a form already holds, across a fork
 * (frame 10, flow `effective-picker`).
 *
 * One `POST /v1/resolve` for the whole batch (500 ids per call). Each id is
 * accounted for independently — a batch mixing redirected, archived and missing
 * values is a normal response, not a partial failure:
 *
 *  - `resolved` — a label and a status. When the service redirected a common
 *    item to the org's fork item, `effectiveItemId` names it and `label` /
 *    `status` are already the fork item's.
 *  - `missing`  — another org's item, or purged: keep the id, render
 *    "Unknown value".
 *
 * The id the host holds is NEVER rewritten here. A host that wants to migrate
 * stored values passes `onEffectiveValue(stored, effective)`; it is called once
 * per redirected id, only after a SUCCESSFUL resolve, and never while the flag
 * is OFF. A failed resolve (`error`) calls nothing — the stored id stays in the
 * form untouched and `retry` re-asks.
 *
 * `status`: `idle` (no ids) · `resolving` (the control is not editable yet and
 * the id is never shown as a label placeholder) · `resolved` · `error`.
 */

import { useEffect, useMemo, useRef } from 'react'
import { resolveStoredValues } from './api'
import { redirectsOf } from './derive'
import { useSharedLists } from './SharedListsFeatureProvider'
import type {
  EffectiveValueRedirect,
  Locale,
  SelectionListItemId,
  StoredValueOutcome,
} from './types'
import { useResource } from './useResource'

export interface UseStoredValuesOptions {
  /** Called once per redirected id after a successful resolve (flag ON only). */
  onEffectiveValue?: (
    stored: SelectionListItemId,
    effective: SelectionListItemId
  ) => void
  locale?: Locale
}

export type UseStoredValuesResult = {
  status: 'idle' | 'resolving' | 'resolved' | 'error'
  /** Keyed by the stored id; empty until `resolved`. */
  outcomes: Record<SelectionListItemId, StoredValueOutcome>
  /** The redirects found in this resolve (also what `onEffectiveValue` received). */
  redirects: EffectiveValueRedirect[]
  retry: () => void
}

const NO_OUTCOMES: Record<SelectionListItemId, StoredValueOutcome> =
  Object.freeze({})
const NO_REDIRECTS: EffectiveValueRedirect[] = []

export function useStoredValues(
  ids: readonly SelectionListItemId[],
  options: UseStoredValuesOptions = {}
): UseStoredValuesResult {
  const { enabled: sharedLists, ready } = useSharedLists()
  const { locale } = options

  // Key on the id CONTENT, so a host re-creating the same array each render does not re-resolve.
  const idsKey = JSON.stringify(
    Array.from(new Set(ids.filter(id => id !== '')))
  )
  const unique = useMemo(
    () => JSON.parse(idsKey) as SelectionListItemId[],
    [idsKey]
  )

  const { settled, reload } = useResource(
    // Not ready ⇒ which resolve (own / shared) is not known yet: ask nothing.
    ready && unique.length > 0
      ? `${sharedLists ? 'shared' : 'own'}|${locale ?? ''}|${idsKey}`
      : null,
    signal => resolveStoredValues(unique, { sharedLists, locale, signal })
  )

  const outcomes = settled.status === 'done' ? settled.value : NO_OUTCOMES
  const redirects = useMemo(
    () =>
      settled.status === 'done' && sharedLists
        ? redirectsOf(settled.value)
        : NO_REDIRECTS,
    [settled, sharedLists]
  )

  // Once per (stored → effective) pair per batch of ids, however often the hook re-renders or retries.
  const onEffectiveValueRef = useRef(options.onEffectiveValue)
  useEffect(() => {
    onEffectiveValueRef.current = options.onEffectiveValue
  })
  const notified = useRef<{ idsKey: string; pairs: Set<string> }>({
    idsKey,
    pairs: new Set(),
  })
  useEffect(() => {
    if (notified.current.idsKey !== idsKey)
      notified.current = { idsKey, pairs: new Set() }
    for (const { stored, effective } of redirects) {
      const pair = `${stored}\u0000${effective}`
      if (notified.current.pairs.has(pair)) continue
      notified.current.pairs.add(pair)
      onEffectiveValueRef.current?.(stored, effective)
    }
  }, [redirects, idsKey])

  let status: UseStoredValuesResult['status']
  switch (settled.status) {
    case 'idle':
      status = 'idle'
      break
    case 'loading':
      status = 'resolving'
      break
    case 'done':
      status = 'resolved'
      break
    case 'failed':
      status = 'error'
      break
  }
  return { status, outcomes, redirects, retry: reload }
}
