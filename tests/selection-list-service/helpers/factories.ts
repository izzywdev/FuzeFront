/**
 * Test-data factories for the selection-list-service test suite.
 * Factories call the real API and require a running service.
 */
import type { SelectionListClient } from '@fuzeone/selection-list-client';
import type {
  SelectionList,
  SelectionListItem,
  SelectionListId,
  SelectionListItemId,
} from '@fuzeone/selection-list-client';

function uid(): string {
  return Math.random().toString(16).slice(2, 8);
}

export interface TestList {
  list: SelectionList;
  client: SelectionListClient;
}

export interface TestListWithItems {
  list: SelectionList;
  items: SelectionListItem[];
  client: SelectionListClient;
}

export async function createTestList(
  client: SelectionListClient,
  overrides: {
    key?: string;
    name?: string;
    source_locale?: 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'zh' | 'ja' | 'hi' | 'ar' | 'he';
    description?: string;
  } = {}
): Promise<SelectionList> {
  const suffix = uid();
  return client.createList({
    key: overrides.key ?? `test-list-${suffix}`,
    name: overrides.name ?? `Test List ${suffix}`,
    source_locale: overrides.source_locale ?? 'en',
    description: overrides.description,
  });
}

export async function createTestListWithItems(
  client: SelectionListClient,
  count: number,
  listOverrides: Parameters<typeof createTestList>[1] = {}
): Promise<TestListWithItems> {
  const list = await createTestList(client, listOverrides);
  const items: SelectionListItem[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = uid();
    const item = await client.createItem(list.id as SelectionListId, {
      code: `ITEM-${suffix}`,
      label: `Item ${i + 1} (${suffix})`,
      sort_order: (i + 1) * 100,
    });
    items.push(item);
  }
  return { list, items, client };
}

export async function createNLists(
  client: SelectionListClient,
  n: number,
  keyPrefix = 'pag'
): Promise<SelectionList[]> {
  const created: SelectionList[] = [];
  for (let i = 0; i < n; i++) {
    const suffix = uid();
    const list = await createTestList(client, {
      key: `${keyPrefix}-${i}-${suffix}`,
      name: `Pagination List ${i} ${suffix}`,
    });
    created.push(list);
  }
  return created;
}

export async function purgeList(
  client: SelectionListClient,
  listId: SelectionListId
): Promise<void> {
  try {
    await client.deleteList(listId, { purge: true });
  } catch {
    // already purged — idempotent
  }
}

export async function archiveList(
  client: SelectionListClient,
  listId: SelectionListId
): Promise<void> {
  try {
    await client.archiveList(listId);
  } catch {
    // idempotent
  }
}

export async function collectAllItems(
  client: SelectionListClient,
  listId: SelectionListId,
  pageSize = 10
): Promise<SelectionListItem[]> {
  const all: SelectionListItem[] = [];
  for await (const item of client.paginate(
    (p) => client.getItems(listId, { ...p, status: 'active' }),
    { limit: pageSize }
  )) {
    all.push(item);
  }
  return all;
}

export async function collectAllLists(
  client: SelectionListClient,
  pageSize = 10
): Promise<SelectionList[]> {
  const all: SelectionList[] = [];
  for await (const list of client.paginate(
    (p) => client.getLists({ ...p, status: 'active' }),
    { limit: pageSize }
  )) {
    all.push(list);
  }
  return all;
}

export type { SelectionListId, SelectionListItemId };
