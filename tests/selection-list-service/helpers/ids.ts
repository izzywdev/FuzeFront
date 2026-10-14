/**
 * Codec-valid fixture ids, and comparison of ids by their canonical (bare UUID) form.
 *
 * WHY THE FIXTURES MUST BE CODEC-VALID
 *   The wire renders organizations and users as TypeIDs (`org_…` / `usr_…`: prefix + 26-char base32 of a
 *   128-bit UUID), but Permit keys tenants and users by the bare UUID, so a service that talks to the
 *   Security API converts at the boundary - and REFUSES an id that is neither a bare UUID nor a codec-valid
 *   TypeID (fail closed, 403 "Authorization service unavailable."). Hand-typed literals such as
 *   `org_01test00000000quota0000000` look right but do not decode, so every fixture id is minted here with
 *   the identity package (`fromUuid`), deterministically from a short tag: the same tag always names the
 *   same org / user, so ids repeated across processes (jest workers, global-setup) and across reruns agree,
 *   and a tag never collides with another type's.
 *
 * WHY COMPARE BY UUID
 *   Which rendering the service stores for a NEW access grant (`selection_list_access.user_id` / `org_id`)
 *   differs between service builds (a TypeID on one, the bare UUID on another), while the HTTP wire is always
 *   `usr_…`. A direct-DB assertion on such a row therefore compares by canonical UUID (`sameId`, `uuidsOf`),
 *   so one assertion is valid on both. Legacy rows the harness INSERTs itself (helpers/db.ts) are legal
 *   legacy data and are read back verbatim.
 */
import { createHash } from 'node:crypto';
import { bytesToUuid, fromUuid, isUuid, toUuid } from '@izzywdev/fuzefront-identity';

/** A stable UUID for `(kind, tag)`: sha-256 bytes with the version-7 / RFC 9562 variant bits set. */
function uuidFor(kind: 'organization' | 'user', tag: string): string {
  const bytes = Uint8Array.from(createHash('sha256').update(`selection-list-service-tests:${kind}:${tag}`).digest().subarray(0, 16));
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  return bytesToUuid(bytes);
}

/** The codec-valid organization TypeID (`org_…`) for `tag`. Deterministic. */
export const testOrg = (tag: string): string => fromUuid('organization', uuidFor('organization', tag));

/** The codec-valid user TypeID (`usr_…`) for `tag`. Deterministic. */
export const testUser = (tag: string): string => fromUuid('user', uuidFor('user', tag));

/**
 * The bare lower-case UUID an `org_…` / `usr_…` TypeID (or a UUID) names. Anything else - a namespaced
 * non-user principal (`svc:…`, `service:…`, `svc_token:…`), a placeholder - is returned unchanged.
 */
export function canonicalUuid(id: string): string {
  if (isUuid(id)) return id.toLowerCase();
  if (/^(org|usr)_[0-9a-z]{26}$/.test(id)) {
    try {
      return toUuid(id as never);
    } catch {
      return id;
    }
  }
  return id;
}

/** True when `a` and `b` name the same org / user, whichever rendering each is in. */
export const sameId = (a: string, b: string): boolean => canonicalUuid(a) === canonicalUuid(b);

/** `ids` as canonical UUIDs, for `expect(uuidsOf(rows.map((r) => r.user_id))).toEqual(uuidsOf([U1]))`. */
export const uuidsOf = (ids: string[]): string[] => ids.map(canonicalUuid);
