# FuzeX design-test link events

FuzeX remains authoritative for UX flows, frames, components, design decisions,
and their traceability. FuzeQuality remains authoritative for QA test cases and
execution evidence. The services exchange only a small, tenant-scoped link.

FuzeX emits the shared `1.0` event envelope on these topics:

- `fuzex.design.test-link.requested`
- `fuzex.design.test-link.removed`

The payload is `{ tenantId, traceLinkId, fuzexProjectId, targetKind,
targetRef, testCaseId }`, where `targetKind` is `flow-step`, `frame`, or
`component`. No HTML, design artifact, user data, permission grant, or signed
URL travels on this integration.

FuzeQuality verifies `testCaseId` through its repository ownership before it
stores the link. A missing, inactive, deleted-tenant, or cross-tenant test case
rejects the event into the source topic DLQ; it cannot create a link. On a
successful state transition FuzeQuality publishes one of:

- `fuzequality.design.test-link.verified`
- `fuzequality.design.test-link.revoked`

using `tenantId:traceLinkId` as the event key. Consumers must treat this as an
at-least-once event and deduplicate by the envelope correlation ID. Deleting an
organization or principal deactivates local membership projections immediately;
authorization still remains fail-closed through FuzeFront Security.
