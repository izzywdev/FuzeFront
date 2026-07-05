# Identity Management UI + API Tokens — Continuation Progress Ledger

Branch: `feature/identity-ui-api-tokens` (PR #65, draft). Worktree branch: `identity-cont`.
Resume base commit at continuation start: `1f837e3`.

## Already DONE (prior wave, committed; verified — do NOT rebuild)
- Backend security-service (`backend/security/`):
  - Migration `010_create_api_tokens_table.ts`
  - `services/api-token.ts` (base62 gen, hashing, verify, CRUD)
  - `middleware/api-token-auth.ts` (ff_ prefix branch, rate limiting, req.apiToken)
  - `routes/api-tokens.ts` (POST/GET/GET:id/DELETE + orgTokensRouter for /api/organizations/:orgId/tokens)
  - `routes/organizations.ts` invitation endpoints (list, single, bulk, resend, revoke) + member CRUD
  - `routes/invitations.ts` public accept (from master)
  - `utils/permit/user-sync.ts` service-token sync/unassign
  - All wired in `index.ts` with tokenAuthRateLimiter.
  - Migration `009_provisioning_backbone.ts` already creates `organization_invitations` table (from master).
- Design system: Modal, DataTable, Textarea, FileDropZone (+ .d.ts, .prompt.md, manifest, index.js exports) + tokens.
- Backend tests: 148 pass. 1 pre-existing suite failure (invitations.integration.test.ts — shared/dist zod resolution; on master, env artifact, unrelated).

## REMAINING (this continuation)
- [ ] Task A: Scaffold `packages/identity-ui` workspace (package.json w/ publishConfig+repository, tsconfig, vite lib config, vitest, src/index.ts barrel, types.ts). Add to root workspaces + lerna packages.
- [ ] Task B: `api/identityClient.ts` + `api/tokens.ts` typed fetch wrappers + unit tests.
- [ ] Task C: i18n provider (en + he, RTL) + EmptyState component.
- [ ] Task D: RoleSelect + MembersTable + tests.
- [ ] Task E: InviteModal (Single + Bulk/CSV) + PendingInvitesList + tests.
- [ ] Task F: API-token UI — ScopeSelector, TokenCreateModal, TokenList + RevokeConfirmDialog + tests.
- [ ] Task G: IdentityPage tabs wiring + public API barrel.
- [ ] Task H: Host shell wiring (OrganizationPage) + frontend build config.
- [ ] Task I: Publish/deploy wiring (packages-publish workflow, build verify dual output + d.ts).

## Notes
- Design-system-first; theme via CSS custom props only.
- identity-ui MUST have publishConfig {registry github npm, access restricted} + repository.
- Pin: @tanstack/react-table@8.21.3, react-hook-form@7.56.4, @hookform/resolvers@3.10.0, papaparse@5.5.2, @types/papaparse@5.3.15.
