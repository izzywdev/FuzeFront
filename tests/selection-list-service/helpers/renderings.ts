/**
 * Fixtures for "one organization, two renderings of its id" suites (duplicate keys, grant groups).
 *
 * The API can no longer CREATE the states these suites need: creating or renaming a list onto a key the org already holds
 * under another rendering of its id is a 409 (flag ON and OFF alike), and the access routes converge a user's grants to
 * one row. Those states exist only as DATA written before that rule (or by hand), which is exactly what the service has to
 * serve deterministically. They are planted with plain SQL into the service's own tables (legal legacy data, like
 * `insertPlatformRowViaSql` in helpers/shared-lists.ts); every ASSERTION is then made over HTTP, through the stand-in
 * Security API, as a caller would see it.
 */
import { mintId } from '@izzywdev/fuzefront-identity';
import { dbQuery } from './db';
import { canonicalUuid, renderingsOf } from './ids';

/** Both stored renderings of one org: `[TypeID, bare UUID]`. */
export const orgForms = (org: string): [string, string] => renderingsOf(org, 'organization') as [string, string];
/** Both stored renderings of one user: `[usr_ TypeID, bare UUID]`. */
export const userForms = (user: string): [string, string] => renderingsOf(user, 'user') as [string, string];

export interface PlantedList {
  id: string;
  /** minted item ids, in `itemCodes` order */
  itemIds: string[];
}

export interface PlantListOptions {
  /** the organization_id text as STORED (a TypeID or a bare UUID: the two renderings are different strings) */
  storedOrg: string;
  key: string;
  visibility?: 'private' | 'org' | 'platform';
  status?: 'active' | 'archived';
  /** how old the row is, in minutes (default 0) */
  ageMinutes?: number;
  /** explicit created_at (wins over ageMinutes) */
  createdAt?: Date;
  /** a common list this row is a fork of (adds the fork provenance columns) */
  forkOf?: { listId: string; orgWire: string };
  /** item codes to create (active), each with an `en` label; for a fork, `originOf[i]` is the source item id of item i */
  itemCodes?: string[];
  originOf?: string[];
  createdBy?: string;
}

/** Insert a list (+ its `en` name, + items) directly. Ids are minted by the identity package, never hand-typed. */
export async function plantList(o: PlantListOptions): Promise<PlantedList> {
  const id = mintId('selectionList') as string;
  const created = o.createdAt ?? new Date(Date.now() - (o.ageMinutes ?? 0) * 60_000);
  await dbQuery(
    `INSERT INTO selection_lists
       (id, organization_id, key, source_locale, status, created_by, visibility, created_at,
        forked_from_list_id, forked_from_org_id, forked_from_revision, forked_at)
     VALUES ($1, $2, $3, 'en', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      o.storedOrg,
      o.key,
      o.status ?? 'active',
      o.createdBy ?? 'system:selection-list-service', // not a user principal: outside every per-user quota
      o.visibility ?? 'private',
      created,
      o.forkOf?.listId ?? null,
      o.forkOf?.orgWire ?? null,
      o.forkOf ? 1 : null,
      o.forkOf ? created : null,
    ],
  );
  await dbQuery(`INSERT INTO selection_list_translations (list_id, locale, name, is_machine) VALUES ($1, 'en', $2, false)`, [id, `${o.key} (${o.storedOrg.slice(0, 12)})`]);
  const itemIds: string[] = [];
  for (const [i, code] of (o.itemCodes ?? []).entries()) {
    const itemId = mintId('selectionListItem') as string;
    itemIds.push(itemId);
    await dbQuery(
      `INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by, origin_item_id) VALUES ($1, $2, $3, $4, 'active', 'system:selection-list-service', $5)`,
      [itemId, id, code, (i + 1) * 100, o.originOf?.[i] ?? null],
    );
    await dbQuery(`INSERT INTO selection_list_item_translations (item_id, locale, label, is_machine) VALUES ($1, 'en', $2, false)`, [itemId, `${code} (${o.storedOrg.slice(0, 12)})`]);
  }
  return { id, itemIds };
}

/** Insert one access-mirror row as legacy data would hold it (`user` and `org` as STORED text; the list must exist). */
export async function plantAccessRow(row: {
  listId: string;
  storedUser: string;
  storedOrg: string;
  role: string;
  grantedBy: string;
  grantedAt: Date;
}): Promise<void> {
  await dbQuery(
    `INSERT INTO selection_list_access (list_id, user_id, org_id, role, granted_by, granted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [row.listId, row.storedUser, row.storedOrg, row.role, row.grantedBy, row.grantedAt],
  );
}

/** The mirror rows of `userId` (either rendering) on one list, with `user_id` as stored. */
export async function accessRowsOf(listId: string, userId: string): Promise<Array<{ user_id: string; org_id: string | null; role: string; revoked_at: Date | null }>> {
  return dbQuery(
    `SELECT user_id, org_id, role, revoked_at FROM selection_list_access WHERE list_id = $1 AND user_id = ANY($2::text[]) ORDER BY user_id`,
    [listId, userForms(userId)],
  );
}

/** The LIVE (not revoked) mirror rows of `userId` on one list. */
export const liveAccessRowsOf = async (listId: string, userId: string) => (await accessRowsOf(listId, userId)).filter((r) => r.revoked_at === null);

export { canonicalUuid };
