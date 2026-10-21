import { useCallback, useEffect, useRef } from 'react'
import type { MfaClient } from '../../types'

/**
 * Tracks the PENDING (not yet activated) factor an enrolment flow created, and
 * removes it when the user abandons the flow: `discard()` on cancel and, as a
 * safety net, on unmount. Best-effort by design — a failed DELETE is swallowed
 * (the factor stays inert: it is `pending`, never offered at sign-in, and
 * deleting a pending factor is always allowed — it is not the "last factor"
 * the 409 guard protects). A hard tab close cannot run this: the pending factor
 * then stays until it is removed (the user can remove it from the MFA overview).
 * There is currently NO server-side expiry of pending factors; adding one is a
 * tracked follow-up.
 */
export function usePendingFactor(api: Pick<MfaClient, 'removeFactor'>) {
  const pending = useRef<string | null>(null)
  const apiRef = useRef(api)
  apiRef.current = api

  const discard = useCallback(() => {
    const id = pending.current
    pending.current = null
    if (!id) return
    void Promise.resolve()
      .then(() => apiRef.current.removeFactor(id))
      .catch(() => {
        /* best-effort cleanup */
      })
  }, [])

  useEffect(() => discard, [discard])

  return {
    /** Remember the pending factor so abandoning the flow removes it. */
    track: (factorId: string) => {
      pending.current = factorId
    },
    /** The factor was activated: it is a real method now, never discard it. */
    clear: () => {
      pending.current = null
    },
    discard,
  }
}
