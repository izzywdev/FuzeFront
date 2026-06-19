# Task A — Scaffold `@fuzefront/identity-ui` package + make design-system a workspace package

## Goal
Create the `packages/identity-ui` workspace React/TS library skeleton (no feature code yet, just config + empty barrels + types + a smoke test that passes), and turn the existing `design-system/` directory into a consumable workspace package `@fuzefront/design-system` so identity-ui can import its components.

## Repo context
- Monorepo. Root `package.json` (`name: frontfuse-platform`, `private: true`) has `workspaces: ["backend","backend/core","backend/security","backend/applications","shared"]`. `lerna.json` has `packages: ["backend","frontend","shared","sdk","task-manager-app","services/email-service","services/sms-service","services/provisioning-service"]`.
- `.npmrc` already maps `@fuzefront:registry=https://npm.pkg.github.com`.
- The frontend (`@fuzefront/frontend`) uses React 18.3.1, Vite, Vitest (jsdom, globals:true, setupFiles ./src/test/setup.ts).
- Design tokens are global CSS custom properties (e.g. `var(--accent-color)`, `var(--bg-tertiary)`, `var(--text-primary)`) defined in the host's `frontend/src/index.css`. Components consume them via inline `style={{ color: 'var(--text-primary)' }}` — NO bundled CSS.
- `design-system/` currently has NO package.json. It ships raw `.jsx` components (each consumes token CSS vars) with sibling `.d.ts`, an auto-generated ESM `design-system/index.js` barrel (`export { Button } from './components/core/Button.jsx'` etc.), and `design-system/_ds_manifest.json`. Available exports include: RoleBadge, Avatar, Badge, Button, IconButton, DataTable, StatusPill, Toast, FileDropZone, Input, Select, Textarea, Modal, SeamDivider, plus more.

## Deliverables

### 1. `design-system/package.json` (NEW)
Make design-system a workspace package so identity-ui can `import { Button } from '@fuzefront/design-system'`. It ships raw JSX (consumers transpile via their bundler/test runner):
```json
{
  "name": "@fuzefront/design-system",
  "version": "1.0.0",
  "description": "FuzeFront \"fuse seam\" design system — token-driven React components",
  "type": "module",
  "main": "index.js",
  "module": "index.js",
  "types": "index.d.ts",
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./index.js" },
    "./tokens/*": "./tokens/*",
    "./styles.css": "./styles.css"
  },
  "files": ["components", "tokens", "index.js", "index.d.ts", "styles.css", "_ds_manifest.json"],
  "peerDependencies": { "react": "^18.0.0", "react-dom": "^18.0.0" },
  "publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" },
  "repository": { "type": "git", "url": "https://github.com/fuzefront/FuzeFront.git", "directory": "design-system" }
}
```
Also create `design-system/index.d.ts` (NEW) that re-exports the types from each component `.d.ts`, mirroring `index.js`. For every `export { X } from './components/.../X.jsx'` line in `index.js`, add `export type * from './components/.../X.d.ts'` is NOT valid for value+type; instead use `export { X } from './components/.../X'` style is also not right for d.ts. Use this exact pattern per component: `export * from './components/core/Button';` — TypeScript resolves `Button.d.ts`. Include one such line for each component currently exported in `index.js` (read `design-system/index.js` to get the full list and matching paths, dropping the `.jsx` extension).

### 2. `packages/identity-ui/package.json` (NEW)
```json
{
  "name": "@fuzefront/identity-ui",
  "version": "0.1.0",
  "description": "Reusable identity / org-member / API-token management UI for FuzeFront, on the fuse-seam design system",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "vite build && tsc -p tsconfig.build.json --emitDeclarationOnly",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-table": "8.21.3",
    "react-hook-form": "7.56.4",
    "@hookform/resolvers": "3.10.0",
    "papaparse": "5.5.2",
    "zod": "3.22.4"
  },
  "peerDependencies": {
    "@fuzefront/design-system": "^1.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@fuzefront/design-system": "1.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/papaparse": "5.3.15",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^2.1.0"
  },
  "publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" },
  "repository": { "type": "git", "url": "https://github.com/fuzefront/FuzeFront.git", "directory": "packages/identity-ui" }
}
```
(MANDATORY: publishConfig with the GitHub registry + restricted access, and a repository field — both packages.)

### 3. `packages/identity-ui/tsconfig.json` (NEW)
React lib config: target ES2020, lib [ES2020, DOM, DOM.Iterable], module ESNext, moduleResolution Bundler, jsx react-jsx, strict true, declaration true, outDir dist, skipLibCheck true, esModuleInterop true, resolveJsonModule true, isolatedModules true, noEmit true (build uses separate tsconfig.build.json). include ["src"].

### 4. `packages/identity-ui/tsconfig.build.json` (NEW)
extends ./tsconfig.json, compilerOptions { noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: dist }, include ["src"], exclude any `*.test.*` and `src/test`.

### 5. `packages/identity-ui/vite.config.ts` (NEW)
Library mode: plugin react() + vite-plugin-dts({ insertTypesEntry: true }). build.lib { entry src/index.ts, formats ['es','cjs'], fileName: (fmt) => fmt === 'cjs' ? 'index.cjs' : 'index.js' }. rollupOptions.external: ['react','react-dom','react/jsx-runtime','@fuzefront/design-system', /^@fuzefront\/design-system\/.*/]. Include a `test` block (vitest): environment 'jsdom', globals true, setupFiles ['./src/test/setup.ts'], css false.

### 6. `packages/identity-ui/src/test/setup.ts` (NEW)
`import '@testing-library/jest-dom'`

### 7. `packages/identity-ui/src/types.ts` (NEW)
Public TS interfaces. Define and export:
- `export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'`
- `export interface Member { id: string; role: OrgRole; status: 'active' | 'pending' | 'suspended'; user: { id: string; email: string; firstName?: string; lastName?: string }; invited_at?: string; joined_at?: string }`
- `export interface Invitation { id: string; email: string; role: OrgRole; status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at?: string; expires_at?: string }`
- `export type TokenOwnerType = 'user' | 'org'`
- `export interface ApiTokenSummary { id: string; name: string; owner_type: TokenOwnerType; owner_id: string; token_prefix: string; scopes: string[]; expires_at: string | null; last_used_at: string | null; created_at?: string; revoked_at?: string | null }`
- `export interface CreatedApiToken extends ApiTokenSummary { token: string }`  // one-time raw token
- `export interface IdentityApiClient { /* method signatures — see below */ }`

For `IdentityApiClient`, declare these method signatures (implementations come in Task B; here only the interface):
```ts
export interface IdentityApiClient {
  listMembers(orgId: string): Promise<Member[]>
  updateMemberRole(orgId: string, memberId: string, role: OrgRole): Promise<void>
  removeMember(orgId: string, memberId: string): Promise<void>
  listInvitations(orgId: string, status?: 'pending' | 'all'): Promise<Invitation[]>
  invite(orgId: string, email: string, role: OrgRole): Promise<void>
  bulkInvite(orgId: string, invitations: { email: string; role: OrgRole }[]): Promise<{ created: number; skipped: number; errors: string[] }>
  resendInvitation(orgId: string, invitationId: string): Promise<void>
  revokeInvitation(orgId: string, invitationId: string): Promise<void>
  listTokens(): Promise<ApiTokenSummary[]>
  listOrgTokens(orgId: string): Promise<ApiTokenSummary[]>
  createToken(input: { name: string; owner_type: TokenOwnerType; owner_id: string; scopes: string[]; expires_at: string | null }): Promise<CreatedApiToken>
  revokeToken(tokenId: string): Promise<void>
}
```

### 8. `packages/identity-ui/src/index.ts` (NEW)
Barrel. For now just re-export types so the package compiles:
```ts
export type { OrgRole, Member, Invitation, TokenOwnerType, ApiTokenSummary, CreatedApiToken, IdentityApiClient } from './types'
```
(Component exports will be added in later tasks.)

### 9. `packages/identity-ui/src/index.smoke.test.ts` (NEW)
A trivial passing test so `vitest run` exits 0 (proves the test harness works):
```ts
import { describe, it, expect } from 'vitest'
import * as pkg from './index'
describe('identity-ui package', () => {
  it('module loads', () => { expect(pkg).toBeDefined() })
})
```

### 10. Root `package.json` — add `"packages/identity-ui"` AND `"design-system"` to the `workspaces` array.

### 11. `lerna.json` — add `"packages/identity-ui"` and `"design-system"` to `packages`.

## Verification (you MUST run and report output)
1. `npm install` from repo root — must resolve `@fuzefront/identity-ui` and `@fuzefront/design-system` workspace symlinks (check `ls node_modules/@fuzefront/`). Network 404s on `@fuzefront/*` during install are EXPECTED and OK (packages aren't published); the workspace symlinks are what matter.
2. From `packages/identity-ui`: `npm test` (vitest run) — smoke test passes.
3. From `packages/identity-ui`: `npm run type-check` — exits 0.

## Constraints
- Do NOT write any feature/component code beyond what's listed — barrels and types only.
- Pin the new deps to the EXACT versions given above.
- Never use `git --no-verify`.
- Commit with a conventional message: `feat(identity-ui): scaffold @fuzefront/identity-ui package + make design-system a workspace package`.
