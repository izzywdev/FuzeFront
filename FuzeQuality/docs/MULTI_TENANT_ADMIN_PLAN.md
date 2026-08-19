# FuzeQuality multi-tenant administration

Tracked by Jira epic **FQ-179**.

## Canonical tenancy

FuzeQuality uses the existing FuzeFront organization ID as `tenantId`. It does
not create a parallel tenant, membership, session, or role store.

- FuzeFront Security verifies the bearer session and supplies the active
  organization.
- FuzeFront authorization evaluates namespaced FuzeQuality actions.
- Organization membership roles remain `owner`, `admin`, `member`, and
  `viewer`.
- The FuzeFront user role `admin` is the platform-owner boundary for future
  cross-organization endpoints.

Normal routes derive the organization exclusively from the verified identity.
They never accept a browser-selected tenant identifier.

## Product flows

### Organization member

1. Enter FuzeQuality from the FuzeFront shell.
2. The shell's established platform session is sent to the FuzeQuality API.
3. The API verifies identity and authorization through FuzeFront Security.
4. Catalog queries are filtered to repositories owned by the active
   organization.
5. Commands persist that verified organization and reject cross-tenant IDs
   without disclosure.

### Platform product owner

1. Open **Platform administration**.
2. Review organization adoption, scan freshness, API/frontend coverage, gaps,
   findings, and implementation health.
3. Select **View organization context**.
4. Enter an explicitly labelled, read-only context; do not impersonate a member
   or alter the user's active membership.
5. Record actor, target organization, correlation ID, reason, and timestamp.
6. Exit context to return to the global portfolio.

## Navigation

```text
FuzeQuality
├── My organization
│   ├── Portfolio
│   ├── Repositories
│   ├── API catalog
│   ├── Frontend inventory
│   ├── Requirements and flows
│   └── Review queue
└── Platform administration
    ├── Organizations
    ├── Users and access
    ├── Global coverage
    ├── Integrations
    ├── Cloud implementations
    ├── Operations
    └── Audit
```

## Delivery slices

| Jira | Slice | Result |
|---|---|---|
| FQ-180 | Tenant isolation | Authenticated tenant-scoped catalog and commands |
| FQ-181 | Product-owner portfolio | Aggregate organizations and audited read-only context |
| FQ-182 | Organization administration | Users, effective access, repositories, and integrations |
| FQ-183 | Operations and audit | Cross-tenant health, implementation lifecycle, and audit |

## FQ-180 compatibility decision

The legacy Jira requirement graph has no organization ownership column. Until
FQ-182 migrates Jira scopes and their requirements, flows, and suggestions,
organization-scoped portfolio responses omit that legacy global graph. This is
a deliberate fail-closed behavior: incomplete tenant attribution must never
become cross-tenant disclosure.
