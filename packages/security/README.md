# @fuzefront/security-client

The provider-agnostic client + types for the **FuzeFront Security API** (AuthN +
AuthZ). Generated from `openapi.yaml` with `openapi-typescript`, so the UI,
backend, and tests all import the SAME types — contract drift becomes a compile
error.

## Provider-agnostic by design

The identity provider (federation / MFA / enrollment) and the authorization
engine (policy / ReBAC) are **swappable implementations** hidden behind internal
server-side adapters (`IdentityProvider`, `AuthorizationProvider`). Consumers,
the frontend SPA, and federated remotes know **only** this API — never a vendor.

**Naming rule (strict):** no vendor/product name appears in any consumer-facing
path, schema name, field, config key, or doc. Open-standard protocol terms
(OIDC/OAuth2/JWKS/PKCE) may appear where they name a genuine wire protocol.

## Surface (`/api/v1/security`)

- **AuthN** — `POST/GET/DELETE /session`, `POST /session/exchange`,
  `GET /social/{provider}/start`, `GET /social/callback`, `POST /signup`,
  `GET /methods`.
- **AuthZ** — `POST /authz/check`, `POST /authz/bulk-check`,
  `GET /authz/permissions`, and tenant/member/role management under `/tenants`.
- **M2M** — `POST /tokens`, `POST /tokens/introspect`.

The stable `Identity` shape is invariant across token-format migrations
(`legacy-hs256` → `federated-jwks`). Fail-closed everywhere.

## Usage

```bash
npm run generate    # openapi-typescript openapi.yaml -o src/generated.ts
npm run build       # tsup (runs generate first via prebuild)
npm run lint:spec   # spectral lint openapi.yaml
```

```ts
import type { components, Identity, AuthMethods } from '@fuzefront/security-client';
type LoginResponse = components['schemas']['LoginResponse'];
```

Published privately to GitHub Packages under `@fuzefront` (`access: restricted`).
