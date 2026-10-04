// seed/flagGate.ts - the flag check the seed library deliberately does NOT make.
//
// `applySeedRequest` / `applyPlatformDefaults` run whatever they are handed; the
// CALLER decides whether seeding is on, per message, with `{ organizationId }`
// (plan section 11):
//   - `fuzefront.selection-lists.seed-defaults` (release, default OFF) gates both
//     consumers and the reconciler, and
//   - seeding ALSO requires the master gate `fuzefront.selection-lists.service` ON for
//     the org (`isSeedDefaultsEnabled` does not check it).
// Both fail closed (no client / error / OFF -> false). The caller's OFF behaviour:
// `identity.org.created` -> skip (the reconciler catches up when ON);
// `seed.requested` -> `recordSeedFailure(..., new SeedFailure('SEEDING_DISABLED', ...))`.
//
// A permission-style flag is rollout convenience only: seeding writes with the service's
// own principal and is bounded by the allowlist and quota, never by this flag alone.

import { isSeedDefaultsEnabled, isSelectionListsEnabled } from '../flags';

export async function isSeedingEnabled(organizationId: string): Promise<boolean> {
  const ctx = { organizationId };
  if (!(await isSelectionListsEnabled(ctx))) return false;
  return isSeedDefaultsEnabled(ctx);
}
