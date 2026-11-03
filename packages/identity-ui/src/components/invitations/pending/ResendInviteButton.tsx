import { useEffect, useState } from 'react'
import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../../i18n/IdentityI18nProvider'
import { formatCountdown } from '../shared/time'

/**
 * "Resend" with a rate-limit cooldown. While `cooldownUntil` (epoch ms) is in the
 * future the button is disabled (`disabled` + `aria-disabled`) and its title
 * counts down ("Resend available in 09:41"); the countdown is also exposed as
 * text for assistive tech. `[data-action="resend"]`, wrapper `[data-state="resend-cooldown"]`.
 */
export function ResendInviteButton({
  invitationId,
  onResend,
  busy = false,
  cooldownUntil,
}: {
  invitationId: string
  onResend: () => void
  busy?: boolean
  cooldownUntil?: number
}) {
  const { messages, t } = useIdentityI18n()
  const p = messages.invitationsV2.pending
  const [now, setNow] = useState(() => Date.now())

  const remainingMs = cooldownUntil ? cooldownUntil - now : 0
  const cooling = remainingMs > 0

  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return
    setNow(Date.now())
    const id = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= cooldownUntil) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const countdown = formatCountdown(Math.ceil(remainingMs / 1000))
  return (
    <span data-state={cooling ? 'resend-cooldown' : undefined} style={{ display: 'inline-flex' }}>
      <Button
        variant="ghost"
        size="sm"
        data-action="resend"
        data-for={invitationId}
        disabled={busy || cooling}
        aria-disabled={busy || cooling}
        title={cooling ? t(p.resendCooldown, { time: countdown }) : undefined}
        aria-label={cooling ? `${p.resend} — ${t(p.resendCooldown, { time: countdown })}` : undefined}
        onClick={onResend}
      >
        ↻ {p.resend}
      </Button>
    </span>
  )
}
