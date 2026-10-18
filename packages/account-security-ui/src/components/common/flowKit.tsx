/**
 * Shared building blocks for the password / MFA / step-up / contact flows.
 *
 * Everything here composes `@fuzefront/design-system` primitives with token
 * styles only (no raw color / spacing / type). `SeamCard` is the "card with the
 * fuse-seam top bar" every approved frame uses; it is product-layer composition
 * (a graduation candidate if a second family repo needs it).
 */
import React, { useMemo } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import {
  AccountSecurityI18nProvider,
  useAccountSecurityI18n,
  type AccountSecurityLocale,
} from '../../i18n/AccountSecurityI18nProvider'
import { createAccountSecurityClient } from '../../api/securityClient'
import type { FullAccountSecurityClient } from '../../types'

/** Props every flow orchestrator accepts for client + locale injection. */
export interface FlowBaseProps {
  /** Injected client (tests/host). Defaults to a same-origin client. */
  client?: Partial<FullAccountSecurityClient>
  /** Bearer-token accessor for the default client. */
  getToken?: () => string | null | undefined
  locale?: AccountSecurityLocale
}

/** Resolve the injected client or build the default same-origin one. */
export function useSecurityClient<C>(
  client: Partial<FullAccountSecurityClient> | undefined,
  getToken: (() => string | null | undefined) | undefined
): C {
  return useMemo(
    () => (client ?? createAccountSecurityClient({ getToken })) as unknown as C,
    [client, getToken]
  )
}

/** Wraps a flow body in the i18n provider so each flow is independently mountable. */
export function FlowRoot({
  locale,
  children,
}: {
  locale?: AccountSecurityLocale
  children: React.ReactNode
}) {
  return <AccountSecurityI18nProvider locale={locale ?? 'en'}>{children}</AccountSecurityI18nProvider>
}

/** Page chrome: direction-aware container with a title + optional subtitle. */
export function FlowPage({
  title,
  subtitle,
  children,
  maxWidth = 'var(--container-2xl)',
  ...rest
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  maxWidth?: string
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  const { dir } = useAccountSecurityI18n()
  return (
    <main
      dir={dir}
      style={{
        maxWidth,
        fontFamily: 'var(--font-sans)',
        color: 'var(--text-primary)',
        // The host shell centres its content area; the approved frames are start-aligned.
        textAlign: 'start',
      }}
      {...rest}
    >
      {title && (
        <h1
          style={{
            margin: '0 0 var(--space-1)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h1>
      )}
      {subtitle && (
        <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>{subtitle}</p>
      )}
      {children}
    </main>
  )
}

type SeamTone = 'default' | 'warning' | 'danger'
const SEAM: Record<SeamTone, string> = {
  default: 'var(--seam)',
  warning: 'var(--warning-color)',
  danger: 'var(--error-color)',
}

/** Card with the fuse-seam top bar (the approved frames' `.card`). */
export function SeamCard({
  tone = 'default',
  children,
  style,
  ...rest
}: { tone?: SeamTone; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        marginBottom: 'var(--space-5)',
        ...style,
      }}
      {...rest}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetBlockStart: 0,
          insetInline: 0,
          height: 'var(--space-1)',
          background: SEAM[tone],
        }}
      />
      {children}
    </div>
  )
}

/** Visible heading inside a card. */
export function CardHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      style={{
        margin: '0 0 var(--space-1)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-lg)',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </h2>
  )
}

/** Muted supporting paragraph. */
export function Hint({
  children,
  ...rest
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      style={{
        margin: '0 0 var(--space-4)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--text-sm)',
        lineHeight: 'var(--leading-normal)',
      }}
      {...rest}
    >
      {children}
    </p>
  )
}

/** Inline field error (alert) — used where the DS `Input` error prop doesn't apply (OTP). */
export function InlineError({
  children,
  ...rest
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        margin: 'var(--space-3) 0',
        color: 'var(--error-color)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
      }}
      {...rest}
    >
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </div>
  )
}

/** Horizontal action row. */
export function Actions({
  children,
  ...rest
}: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
        marginBlockStart: 'var(--space-5)',
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

/** Error StatusCallout with a single retry action (generic fail-closed state). */
export function ErrorWithRetry({
  title,
  text,
  retryLabel,
  onRetry,
  ...rest
}: {
  title: string
  text: string
  retryLabel: string
  onRetry: () => void
} & Record<string, unknown>) {
  return (
    <div {...rest}>
      <StatusCallout
        tone="error"
        icon="!"
        title={title}
        actions={
          <Button variant="primary" data-action="retry" onClick={onRetry}>
            {retryLabel}
          </Button>
        }
      >
        {text}
      </StatusCallout>
    </div>
  )
}
