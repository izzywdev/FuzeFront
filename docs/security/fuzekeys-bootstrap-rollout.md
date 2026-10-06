# FuzeKeys Security bootstrap release

Release this additive platform PR before FuzeKeys #205 and connector FuzeFront #1203.
The independent branch contains policy instance-role support, trusted explicit session
tenant verification, active SQL membership proof, and fresh scoped owner-grant validation.
It contains no connector runtime or google-shared-v1 deployment prerequisite.

1. Merge through required checks and deploy backend registry and Security images.
2. Verify session GET with a tenant validates active SQL membership and organization.
3. Register the FuzeKeys policy through the existing app registry. Run the backend
   permit-schema-sync job or backend startup sync, and verify live underscore keys
   fuzekeys_Identity, fuzekeys_Account, fuzekeys_VaultAsset with owner instance roles.
   Policy acceptance alone is insufficient evidence of propagation.
4. Apply reviewed immutable owner inventory through the privileged operator path.
   Membership is checked before grants and rechecked on each mutation.
5. Verify exact instance authorization decisions before enabling FuzeKeys enforcement.
6. Deploy FuzeKeys and verify google-shared-v1; then release connector FuzeFront.

The Security policy CLI retains legacy dot keys and is not the registered-product
runtime sync path. Do not use it to rename deployed resources or migrate grants.
Grant validation references canonical underscore keys intentionally; grant application
must stop until live canonical policy evidence exists. No enforcement switch is enabled
by this bootstrap release.
