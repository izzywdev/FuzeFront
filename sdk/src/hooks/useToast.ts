import { useCallback } from 'react'
import { getBridge } from '../bridge'
import type { ToastInput } from '../bridge'

/** Show toasts through the host's shared toaster (window.__FUZEFRONT__). */
export function useToast() {
  const notify = useCallback(
    (toast: ToastInput): string | undefined => getBridge()?.notify(toast),
    []
  )
  const dismiss = useCallback(
    (id: string): void => getBridge()?.dismiss(id),
    []
  )
  return { notify, dismiss }
}
