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
 *
 * INVARIANT: discard never DELETEs a factor whose server status it has not
 * confirmed. After an ambiguous activation outcome (5xx / 429 / network) the factor
 * is `indeterminate`: the server may have activated it, and the backend can delete
 * an active factor when another active one exists. Discard then reconciles via the
 * factor listing and deletes only if the server still reports it `pending`; an
 * active factor is kept, and a failed listing leaves it inert (no delete).
 */
export function usePendingFactor(api: Pick<MfaClient, 'removeFactor' | 'listFactors'>) {
  const pending = useRef<string | null>(null)
  const activation = useRef<Promise<unknown> | null>(null)
  const indeterminate = useRef(false)
  const apiRef = useRef(api)
  apiRef.current = api

  const discard = useCallback(() => {
    const id = pending.current
    pending.current = null
    if (!id) return
    const inFlight = activation.current
    // Delete only what the server confirms is still pending.
    const reconcile = async () => {
      const factors = await apiRef.current.listFactors() // a failure rejects → no delete
      if (factors.find((f) => f.factorId === id)?.status === 'pending') {
        await apiRef.current.removeFactor(id)
      }
    }
    const removal = inFlight
      ? inFlight.then(
          () => undefined, // activated: a real method now — never delete
          (err) => (isInvalidCode(err) ? apiRef.current.removeFactor(id) : reconcile())
        )
      : indeterminate.current
        ? Promise.resolve().then(reconcile)
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
      indeterminate.current = false
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
      indeterminate.current = false
      const tracked = request
        .catch((err: unknown) => {
          // Not a definitive rejection → the server may have activated it.
          if (!isInvalidCode(err)) indeterminate.current = true
          throw err
        })
        .finally(() => {
          if (activation.current === tracked) activation.current = null
        })
      activation.current = tracked
      return tracked
    },
    discard,
  }
}
