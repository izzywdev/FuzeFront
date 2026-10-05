# Product resource instance roles

Products retain their own policy declaration and register it through the existing app-registry flow. Optional resource `roles` grant bare action permissions on a specific resource instance; top-level `roles` remain tenant-scoped and backward compatible. Optional `relations` map relation keys to bare resource targets within the same product. Derivation requires an existing target role and a declared relation pointing at that target. Cross-product references are rejected.

Canonical backend keys use the underscore namespace (`fuzekeys_Vault`), matching the registration contract. The security service copy still uses legacy dot keys. This change preserves both existing conventions: do not silently rename live Permit resources or grants. Before enabling instance-grant enforcement in that service, reconcile deployed resource keys and explicitly migrate grants. No bootstrap grant, backfill, route enforcement, or live policy sync is enabled by this contract change.

FuzeKeys may declare `Vault` and `Secret` with instance `owner` roles and a `vault` relation. Granting `owner` requires a verified platform subject and tenant, and a privileged workload with a narrowly scoped provisioning action. Never substitute a local numeric user ID or assign instance ownership as a tenant-wide role.
