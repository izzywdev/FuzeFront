# Product resource instance roles

Products retain their own policy declaration and register it through the existing app-registry flow. Optional resource `roles` grant bare action permissions on a specific resource instance; top-level `roles` remain tenant-scoped and backward compatible. Optional `relations` map relation keys to bare resource targets within the same product. Derivation requires an existing target role and a declared relation pointing at that target. Cross-product references are rejected.

Canonical backend keys use the underscore namespace (`fuzekeys_Vault`), matching the registration contract. The security service copy still uses legacy dot keys. This change preserves both existing conventions: do not silently rename live Permit resources or grants. Before enabling instance-grant enforcement in that service, reconcile deployed resource keys and explicitly migrate grants. No bootstrap grant, backfill, route enforcement, or live policy sync is enabled by this contract change.

FuzeKeys may declare `Vault` and `Secret` with instance `owner` roles and a `vault` relation. Granting `owner` requires a verified platform subject and tenant, and a privileged workload with a narrowly scoped provisioning action. Never substitute a local numeric user ID or assign instance ownership as a tenant-wide role.

## Runtime propagation and rollout order

`applications/src/routes/app-registry.ts` accepts `PUT /apps/:slug/policy` through the onboarding schema and stores it in `apps.policy`. The route does not immediately update Permit. Backend boot and the Helm `permit-schema-sync` job read registered policies through `backend/src/permit/sync-permit-schema.ts`, then apply canonical underscore keys. The job runs the backend image, not the security-service image. The security copy has no registration sync invocation from its entrypoint; its CLI syncs the base schema only. Its dot convention is therefore a dormant compatibility risk, not evidence that the active registered-product path requires a live rename.

Deploy this additive platform contract before a consumer submits resource instance roles. Then register its policy and run a backend registry sync (or restart/upgrade that invokes it), verify the registered product appears in successful Permit sync status, and verify exact resource roles exist before enabling consumer grant backfill or enforcement. The platform contract can release independently of the connector feature PR; the consumer cannot assume policy acceptance implies propagation.
