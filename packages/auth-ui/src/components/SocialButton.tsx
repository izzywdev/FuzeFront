import React from 'react'
import { GoogleGlyph } from './GoogleGlyph'

export interface SocialButtonProps {
  /** Only `google` exists today (the contract's `SocialProvider`). */
  provider?: 'google'
  /** Idle label, e.g. "Continue with Google". Also the accessible name. */
  label: string
  /** Label while the redirect is starting. */
  pendingLabel?: string
  pending?: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * SocialButton — the secondary "continue with <provider>" button. The caller gates
 * it on `AuthMethods.social` (never render it for a provider the platform does not
 * advertise). Test hook: `data-action="social-google"`. No vendor identity-provider
 * name is ever rendered — only the social provider's own brand mark, which Google's
 * identity guidelines require.
 */
export function SocialButton({
  provider = 'google',
  label,
  pendingLabel,
  pending = false,
  disabled = false,
  onClick,
}: SocialButtonProps) {
  return (
    <button
      type="button"
      className="fzf-auth-panel__google-button"
      data-action={`social-${provider}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <GoogleGlyph />
      {pending && pendingLabel ? pendingLabel : label}
    </button>
  )
}
