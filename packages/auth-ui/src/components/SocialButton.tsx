import React from 'react'
import type { SocialProviderSlug } from '../types'
import { GoogleGlyph } from './GoogleGlyph'
import { FacebookGlyph } from './FacebookGlyph'

export interface SocialButtonProps {
  /** `google` (the contract's `SocialProvider`) or `facebook` (shown only when the server advertises it). */
  provider?: SocialProviderSlug
  /** Idle label, e.g. "Continue with Google". Also the accessible name. */
  label: string
  /** Label while the redirect is starting. */
  pendingLabel?: string
  pending?: boolean
  disabled?: boolean
  onClick: () => void
}

const GLYPHS: Record<SocialProviderSlug, React.ComponentType> = {
  google: GoogleGlyph,
  facebook: FacebookGlyph,
}

/**
 * SocialButton — the secondary "continue with <provider>" button. The caller gates
 * it on `AuthMethods.social` (never render it for a provider the platform does not
 * advertise). Test hook: `data-action="social-google"` / `social-facebook`. No vendor
 * identity-provider name is ever rendered — only the social provider's own brand
 * mark, which each provider's identity guidelines require.
 */
export function SocialButton({
  provider = 'google',
  label,
  pendingLabel,
  pending = false,
  disabled = false,
  onClick,
}: SocialButtonProps) {
  const Glyph = GLYPHS[provider]
  return (
    <button
      type="button"
      className="fzf-auth-panel__social-button"
      data-action={`social-${provider}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <Glyph />
      {pending && pendingLabel ? pendingLabel : label}
    </button>
  )
}
