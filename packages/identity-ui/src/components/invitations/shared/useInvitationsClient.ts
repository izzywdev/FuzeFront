import { useMemo, useRef } from 'react'
import type { HttpClientOptions } from '../../../api/http'
import { createInvitationsClient, type InvitationsApiClient } from '../../../api/invitationsClient'

/**
 * The invitations client for a flow: the injected one (tests / custom transport)
 * or a default same-origin client. `getToken` is read through a ref, so a host
 * passing an inline arrow (`getToken={() => getActiveAuthToken()}`) does NOT
 * rebuild the client — and thereby re-trigger every `useCallback`/`useEffect`
 * keyed on it — on each parent render.
 */
export function useInvitationsClient(
  injected: InvitationsApiClient | undefined,
  getToken: HttpClientOptions['getToken'],
): InvitationsApiClient {
  const tokenRef = useRef(getToken)
  tokenRef.current = getToken
  return useMemo(
    () => injected ?? createInvitationsClient({ getToken: () => tokenRef.current?.() }),
    [injected],
  )
}
