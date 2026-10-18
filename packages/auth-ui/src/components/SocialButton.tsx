import React from 'react'
import type { SocialProviderSlug } from '../types'
import { GoogleGlyph } from './GoogleGlyph'
import { FacebookGlyph } from './FacebookGlyph'

export interface SocialButtonProps {
  provider: SocialProviderSlug
  /** Visible + accessible label ("Continue with Facebook"). */
  label: string
  disabled?: boolean
  onClick: () => void
}

const GLYPHS: Record<SocialProviderSlug, React.ComponentType> = {
  google: GoogleGlyph,
  facebook: FacebookGlyph,
}

/**
 * One social sign-in button. Provider-specific only in its glyph and
 * `data-action` hook (`social-google` / `social-facebook`, per
 * design/frames/org-invitations-v2/04-accept-signup-bind.html); layout and
 * states come from the shared `fzf-auth-panel__social-button` style.
 */
export function SocialButton({ provider, label, disabled, onClick }: SocialButtonProps) {
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
      {label}
    </button>
  )
}
