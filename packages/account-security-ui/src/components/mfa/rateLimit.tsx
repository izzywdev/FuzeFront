import { useEffect, useState } from 'react'
import { StatusCallout } from '@fuzefront/design-system'
import { useAccountSecurityI18n } from '../../i18n/AccountSecurityI18nProvider'

/** `m:ss` (no zero-padded minutes), e.g. 4:59. */
export function formatWait(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Absolute epoch-ms deadline for a 429, or null when the server gave no usable `Retry-After`. */
export function retryDeadline(retryAfterSeconds: number | undefined): number | null {
  return retryAfterSeconds && retryAfterSeconds > 0 ? Date.now() + retryAfterSeconds * 1000 : null
}

/**
 * Seconds until `deadline` (epoch ms), ticking once a second; `null` when the wait is
 * unknown (no valid `Retry-After`). A new deadline (a repeated 429) restarts the count.
 */
export function useRetryCountdown(deadline: number | null | undefined): number | null {
  const remaining = () => (deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null)
  const [left, setLeft] = useState<number | null>(remaining)
  useEffect(() => {
    setLeft(remaining())
    if (!deadline) return
    const id = setInterval(() => {
      const r = remaining()
      setLeft(r)
      if (r === 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline])
  return left
}

/** "Too many attempts" warning callout with the live Retry-After countdown (429 RATE_LIMITED). */
export function RateLimitCallout({ seconds }: { seconds: number | null }) {
  const { messages: m } = useAccountSecurityI18n()
  const [before, after = ''] =
    seconds === null ? [m.stepUp.rateLimitedUnknown] : m.stepUp.rateLimitedText.split('{time}')
  return (
    <div data-error="rate-limited" style={{ marginBlockEnd: 'var(--space-4)' }}>
      <StatusCallout tone="warning" icon="⏳" title={m.stepUp.rateLimitedTitle} role="alert">
        {before}
        {seconds !== null && (
          <>
            <b data-value="retry-after">{formatWait(seconds)}</b>
            {after}
          </>
        )}
      </StatusCallout>
    </div>
  )
}

/** Label for the retry button while a wait is pending ("Try again in 4:59"), else "Try again". */
export function retryButtonLabel(m: { stepUp: { tryAgain: string; tryAgainIn: string } }, seconds: number | null): string {
  return seconds && seconds > 0 ? m.stepUp.tryAgainIn.replace('{time}', formatWait(seconds)) : m.stepUp.tryAgain
}
