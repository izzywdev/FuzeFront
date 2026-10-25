import { useCallback, useEffect, useRef } from 'react'
import type { MfaClient } from '../../types'
import { isInvalidCode } from '../../api/errors'

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
 *
 * Discard is coordinated with an OUTSTANDING activation (`activating(promise)`):
 * deleting a factor whose activation is in flight could remove a method the server
 * is just then activating (a late "success" for a deleted method). So discard waits
 * for the activation to settle, then: success → keep (clear); a definitive code
 * rejection (400/401/403/422) → delete; an ambiguous failure (5xx / 429 / network —
 * the server may have committed) → leave it, never risk deleting a live method.
 */
export function usePendingFactor(api: Pick<MfaClient, 'removeFactor'>) {
  const pending = useRef<string | null>(null)
  const activation = useRef<Promise<unknown> | null>(null)
  const apiRef = useRef(api)
  apiRef.current = api

  const discard = useCallback(() => {
    const id = pending.current
    pending.current = null
    if (!id) return
    const inFlight = activation.current
    const removal = inFlight
      ? inFlight.then(
          () => undefined, // activated: a real method now — never delete
          (err) => (isInvalidCode(err) ? apiRef.current.removeFactor(id) : undefined)
        )
      : Promise.resolve().then(() => apiRef.current.removeFactor(id))
    void removal
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
    /**
     * Register the outstanding activation request so an abandon (unmount / back)
     * waits for it instead of racing a DELETE against it. Returns the promise.
     */
    activating: <T,>(request: Promise<T>): Promise<T> => {
      const tracked = request.finally(() => {
        if (activation.current === tracked) activation.current = null
      })
      activation.current = tracked
      return tracked
    },
    discard,
  }
}
