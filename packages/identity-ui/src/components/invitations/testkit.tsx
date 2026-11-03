import { vi } from 'vitest'
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { IdentityI18nProvider, type IdentityLocale } from '../../i18n/IdentityI18nProvider'
import type {
  InvitationResolveResult,
  InvitationsApiClient,
  OrgInvitation,
} from '../../api/invitationsClient'
import { HttpError } from '../../api/http'

/** Test-only helpers for the org-invitations-v2 suites (not exported from the package). */
export function renderI18n(ui: ReactElement, locale: IdentityLocale = 'en') {
  return render(<IdentityI18nProvider locale={locale}>{ui}</IdentityI18nProvider>)
}

export function invitation(over: Partial<OrgInvitation> = {}): OrgInvitation {
  return {
    id: 'inv_01hy',
    organizationId: 'org_1',
    invitee: { kind: 'external', channel: 'email', email: 'jordan@acme.com' },
    channel: 'email',
    role: 'admin',
    memberType: 'employee',
    status: 'pending',
    invitedByUserId: 'usr_me',
    createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    ...over,
  }
}

export function resolved(over: Partial<InvitationResolveResult['invitation']> = {}): InvitationResolveResult {
  return {
    invitation: {
      id: 'inv_01hy',
      maskedContact: 'j***@acme.com',
      channel: 'email',
      role: 'admin',
      memberType: 'employee',
      status: 'pending',
      expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      ...over,
    },
    organization: { id: 'org_1', name: 'Northwind' },
  }
}

export function fakeClient(over: Partial<InvitationsApiClient> = {}): InvitationsApiClient {
  return {
    list: vi.fn().mockResolvedValue({ items: [], page: { nextCursor: null, hasMore: false } }),
    create: vi.fn().mockResolvedValue(invitation()),
    resend: vi.fn().mockResolvedValue(invitation()),
    revoke: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(resolved()),
    accept: vi.fn().mockResolvedValue({
      action: 'bound',
      organizationId: 'org_1',
      userId: 'usr_me',
      role: 'admin',
      memberType: 'employee',
    }),
    ...over,
  }
}

export const http = (status: number, body?: unknown) => new HttpError(status, `HTTP ${status}`, body)
