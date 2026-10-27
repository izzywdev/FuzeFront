/**
 * Carrying "you just forked" across the navigation to the fork's detail.
 *
 * The dialog closes and navigates (frame 06); the success notice renders on
 * ARRIVAL. React Router location state carries it: it survives the route change
 * and a reload (history state), and `clearForkNotice` removes it once dismissed.
 */

import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** The route the host mounts the flows on (the existing flows use the same literal). */
export const SELECTION_LISTS_ROUTE = '/settings/selection-lists'

export const FORK_NOTICE_STATE_KEY = 'slForkNotice'

export interface ForkNotice {
  /** 201 → a new fork; 200 → the organization's existing one. */
  kind: 'created' | 'existing'
}

export const listRoute = (listId: string): string =>
  `${SELECTION_LISTS_ROUTE}/${encodeURIComponent(listId)}`

/** The `state` to pass to `navigate()` when landing on the fork. */
export function forkNoticeState(notice: ForkNotice): Record<string, ForkNotice> {
  return { [FORK_NOTICE_STATE_KEY]: notice }
}

/** The notice carried by `state`, or `null` for anything else (fail-closed: unknown shapes are ignored). */
export function readForkNotice(state: unknown): ForkNotice | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as Record<string, unknown>)[FORK_NOTICE_STATE_KEY]
  if (typeof value !== 'object' || value === null) return null
  const kind = (value as { kind?: unknown }).kind
  return kind === 'created' || kind === 'existing' ? { kind } : null
}

/** `state` with the notice removed (other keys are kept). */
export function withoutForkNotice(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null
  const { [FORK_NOTICE_STATE_KEY]: _dropped, ...rest } = state as Record<
    string,
    unknown
  >
  return Object.keys(rest).length > 0 ? rest : null
}

/** The notice for the current location + a function that clears it. Needs a Router. */
export function useForkNotice(): {
  notice: ForkNotice | null
  clear: () => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const clear = useCallback(() => {
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: withoutForkNotice(location.state) }
    )
  }, [navigate, location])
  return { notice: readForkNotice(location.state), clear }
}
