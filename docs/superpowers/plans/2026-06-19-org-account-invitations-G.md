# Plan G: Org-account + Invitations

## Backend (security-service)

- `backend/security/src/routes/organizations.ts` — add invitation sub-routes:
  - `GET /api/organizations/:id/invitations` — list pending (owner|admin only)
  - `POST /api/organizations/:id/invitations` — create invitation + email event
  - `POST /api/organizations/:id/invitations/bulk` — bulk create (max 50)
  - `POST /api/organizations/:id/invitations/:invitationId/resend` — resend email
  - `DELETE /api/organizations/:id/invitations/:invitationId` — revoke
- `backend/security/src/routes/invitations.ts` — token-based public routes:
  - `GET /api/invitations/:token` — public resolve
  - `POST /api/invitations/:token/accept` — accept (auth optional)
- `backend/security/src/index.ts` — register `/api/invitations` router

## Backend Tests

- `backend/security/tests/organizations.invitations.test.ts` — unit tests with mocked DB and eventPublisher

## Frontend

- `frontend/src/services/api.ts` — invitation helper functions + `OrganizationInvitation` type
- `frontend/src/pages/AcceptInvitePage.tsx` — new page for `/invitations/:token`
- `frontend/src/pages/CreateOrganizationPage.tsx` — auto-derive slug, dispatch `SET_ORGANIZATIONS`
- `frontend/src/App.tsx` — add `/invitations/:token` route outside auth guard
- `frontend/src/components/ProvisioningCard.tsx` — i18n via `useLanguage()`
- `frontend/src/pages/LoginPage.tsx` — replace hardcoded sign-up strings with `t()` calls

## Frontend Tests

- `frontend/src/__tests__/CreateOrganizationPage.test.tsx`
- `frontend/src/__tests__/AcceptInvitePage.test.tsx`
