// Deterministic, codec-valid ids for fixtures.
//
// The service names tenants and users to the Security API by their bare UUID and REFUSES an id that is neither a
// UUID nor a codec-valid TypeID (src/lib/permitKeys.ts), so a fixture like `usr_tester01` (not a TypeID) can no
// longer stand in for a user. `usr('tester01')` / `org('acme')` give a stable valid TypeID per label and
// `permitKey(id)` the bare UUID the Security API is sent for it.

import { createHash } from 'crypto';
import { fromUuid, toUuid } from '@izzywdev/fuzefront-identity';

function uuidFor(label: string): string {
  const h = createHash('sha1').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A valid `usr_...` TypeID, stable per label. */
export const usr = (label: string): string => fromUuid('user', uuidFor(`user:${label}`));
/** A valid `org_...` TypeID, stable per label. */
export const org = (label: string): string => fromUuid('organization', uuidFor(`organization:${label}`));
/** The bare UUID the Security API is sent for a TypeID (identity: a bare UUID is returned as it is). */
export const permitKey = (typeId: string): string => toUuid(typeId as never);
