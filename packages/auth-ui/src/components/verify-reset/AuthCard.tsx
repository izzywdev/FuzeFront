import React from 'react'
import { AuthCard as DsAuthCard } from '@fuzefront/design-system'

export type HeroIconKind = 'mail' | 'success' | 'error'

const PATHS: Record<HeroIconKind, React.ReactNode> = {
  mail: (
    <>
      <rect x="3" y="6" width="26" height="20" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M4 8l12 9 12-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  success: (
    <>
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
      <path d="M10 16.5 14.5 21 23 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  error: (
    <>
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
      <path d="M16 9v8M16 21h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
}

export interface AuthFlowCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Hero glyph above the title (decorative). */
  icon?: HeroIconKind
  title: string
  subtitle?: React.ReactNode
  /** Centre the content (confirmation / status cards). */
  centered?: boolean
  /** `h1` for a page's primary card, `h2` inside a multi-card view. */
  headingLevel?: 1 | 2
  children?: React.ReactNode
}

/**
 * AuthCard — the shared chrome for the verify/reset cards: the DS seam-topped
 * `AuthCard` + optional hero glyph + title + subtitle. Composes the base
 * primitive; never re-implements it.
 */
export function AuthCard({
  icon,
  title,
  subtitle,
  centered = false,
  headingLevel = 1,
  children,
  ...rest
}: AuthFlowCardProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <DsAuthCard align={centered ? 'center' : 'left'} {...rest}>
      <div className={`fzf-vr-card${centered ? ' fzf-vr-card--centered' : ''}`}>
        {icon && (
          <div className={`fzf-vr-hero fzf-vr-hero--${icon}`} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" className="fzf-vr-hero__svg">
              {PATHS[icon]}
            </svg>
          </div>
        )}
        <Heading className="fzf-vr-title">{title}</Heading>
        {subtitle && <p className="fzf-vr-sub">{subtitle}</p>}
        {children}
      </div>
    </DsAuthCard>
  )
}
