// quota.service.test.ts — Unit tests for S6 quota service (FFRNT-189).
//
// Tests DB-default and DB-override quota resolution, checkListQuota,
// checkItemQuota, and getQuotaUsage.
//
// The knex db singleton is mocked so no real DB connection is required.

// ─── Mock the db module before any imports resolve it ────────────────────────

// Each call to db(tableName) returns a chainable query builder mock.
// Tests override `mockQueryResult` / `mockQuotaRow` per-test to control outcomes.

let mockQuotaRow: Record<string, unknown> | undefined = undefined;
let mockListCount = '0';
let mockItemCount = '0';
let mockUserListCount = '0';

// Tracks which table was queried (for assertion in some tests)
const queriedTables: string[] = [];

// Factory that builds a chainable query builder mock
const makeQB = (table: string) => {
  // Track which table the test queried
  queriedTables.push(table);

  const qb = {
    where: jest.fn().mockReturnThis(),
    count: jest.fn().mockReturnThis(),
    first: jest.fn().mockImplementation(async () => {
      if (table === 'selection_list_org_quota') return mockQuotaRow;
      if (table === 'selection_lists') {
        // Determine if this is a user-scoped or org-scoped query
        const whereCall = (qb.where as jest.Mock).mock.calls[0]?.[0];
        if (whereCall?.created_by) return { count: mockUserListCount };
        return { count: mockListCount };
      }
      if (table === 'selection_list_items') return { count: mockItemCount };
      return undefined;
    }),
  };
  return qb;
};

jest.mock('../src/db', () => ({
  db: jest.fn((table: string) => makeQB(table)),
}));

// ─── Imports (after mock setup) ───────────────────────────────────────────────

import {
  QuotaExceededError,
  getQuota,
  checkListQuota,
  checkItemQuota,
  getQuotaUsage,
  DEFAULT_MAX_LISTS,
  DEFAULT_MAX_LISTS_PER_USER,
  DEFAULT_MAX_ITEMS_PER_LIST,
  DEFAULT_MAX_LOCALES,
} from '../src/services/quota.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
  mockQuotaRow = undefined;
  mockListCount = '0';
  mockItemCount = '0';
  mockUserListCount = '0';
  queriedTables.length = 0;
  (require('../src/db').db as jest.Mock).mockClear();
}

// ─── QuotaExceededError ───────────────────────────────────────────────────────

describe('QuotaExceededError', () => {
  it('is an instance of Error', () => {
    const err = new QuotaExceededError('org_lists', 100, 100, 'lists');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(QuotaExceededError);
  });

  it('exposes scope, current, limit, and resource', () => {
    const err = new QuotaExceededError('list_items', 500, 500, 'items');
    expect(err.scope).toBe('list_items');
    expect(err.current).toBe(500);
    expect(err.limit).toBe(500);
    expect(err.resource).toBe('items');
  });

  it('message includes resource and counts', () => {
    const err = new QuotaExceededError('org_lists', 99, 100, 'lists');
    expect(err.message).toContain('lists');
    expect(err.message).toContain('99');
    expect(err.message).toContain('100');
  });

  it('name is QuotaExceededError', () => {
    const err = new QuotaExceededError('user_lists', 20, 20, 'user-lists');
    expect(err.name).toBe('QuotaExceededError');
  });
});

// ─── getQuota ─────────────────────────────────────────────────────────────────

describe('getQuota', () => {
  beforeEach(resetMocks);

  it('returns platform defaults when no row exists in DB', async () => {
    mockQuotaRow = undefined;

    const result = await getQuota('org_abc');

    expect(result.maxLists).toBe(DEFAULT_MAX_LISTS);
    expect(result.maxListsPerUser).toBe(DEFAULT_MAX_LISTS_PER_USER);
    expect(result.maxItemsPerList).toBe(DEFAULT_MAX_ITEMS_PER_LIST);
    expect(result.maxLocales).toBe(DEFAULT_MAX_LOCALES);
  });

  it('returns per-org overrides when a row exists', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: 50,
      max_lists_per_user: 10,
      max_items_per_list: 250,
      max_locales: 5,
    };

    const result = await getQuota('org_abc');

    expect(result.maxLists).toBe(50);
    expect(result.maxListsPerUser).toBe(10);
    expect(result.maxItemsPerList).toBe(250);
    expect(result.maxLocales).toBe(5);
  });

  it('uses platform default for any NULL override in the row', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: null,
      max_lists_per_user: 5,
      max_items_per_list: null,
      max_locales: null,
    };

    const result = await getQuota('org_abc');

    expect(result.maxLists).toBe(DEFAULT_MAX_LISTS);       // NULL → default
    expect(result.maxListsPerUser).toBe(5);                 // override
    expect(result.maxItemsPerList).toBe(DEFAULT_MAX_ITEMS_PER_LIST); // NULL → default
    expect(result.maxLocales).toBe(DEFAULT_MAX_LOCALES);   // NULL → default
  });
});

// ─── checkListQuota ───────────────────────────────────────────────────────────

describe('checkListQuota', () => {
  beforeEach(resetMocks);

  it('does not throw when current count is below the limit', async () => {
    mockListCount = '5';
    await expect(checkListQuota('org_abc')).resolves.toBeUndefined();
  });

  it('does not throw when current count is one below the limit', async () => {
    mockListCount = String(DEFAULT_MAX_LISTS - 1);
    await expect(checkListQuota('org_abc')).resolves.toBeUndefined();
  });

  it('throws QuotaExceededError when current count equals the limit', async () => {
    mockListCount = String(DEFAULT_MAX_LISTS);

    await expect(checkListQuota('org_abc')).rejects.toThrow(QuotaExceededError);
  });

  it('throws QuotaExceededError when current count exceeds the limit', async () => {
    mockListCount = String(DEFAULT_MAX_LISTS + 5);

    await expect(checkListQuota('org_abc')).rejects.toThrow(QuotaExceededError);
  });

  it('error uses scope=org_lists and correct current/limit', async () => {
    mockListCount = String(DEFAULT_MAX_LISTS);

    const err = await checkListQuota('org_abc').catch((e: QuotaExceededError) => e);

    expect(err).toBeInstanceOf(QuotaExceededError);
    if (err instanceof QuotaExceededError) {
      expect(err.scope).toBe('org_lists');
      expect(err.current).toBe(DEFAULT_MAX_LISTS);
      expect(err.limit).toBe(DEFAULT_MAX_LISTS);
    }
  });

  it('respects per-org override limit', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: 5,
      max_lists_per_user: null,
      max_items_per_list: null,
      max_locales: null,
    };
    mockListCount = '5'; // at the override limit

    await expect(checkListQuota('org_abc')).rejects.toThrow(QuotaExceededError);
  });

  it('passes with per-org override when count is below override limit', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: 5,
      max_lists_per_user: null,
      max_items_per_list: null,
      max_locales: null,
    };
    mockListCount = '4'; // below the override limit

    await expect(checkListQuota('org_abc')).resolves.toBeUndefined();
  });
});

// ─── checkItemQuota ───────────────────────────────────────────────────────────

describe('checkItemQuota', () => {
  beforeEach(resetMocks);

  it('does not throw when item count is below the limit', async () => {
    mockItemCount = '10';
    await expect(checkItemQuota('list_xyz', 'org_abc')).resolves.toBeUndefined();
  });

  it('does not throw when item count is one below the limit', async () => {
    mockItemCount = String(DEFAULT_MAX_ITEMS_PER_LIST - 1);
    await expect(checkItemQuota('list_xyz', 'org_abc')).resolves.toBeUndefined();
  });

  it('throws QuotaExceededError when item count equals the limit', async () => {
    mockItemCount = String(DEFAULT_MAX_ITEMS_PER_LIST);
    await expect(checkItemQuota('list_xyz', 'org_abc')).rejects.toThrow(QuotaExceededError);
  });

  it('throws QuotaExceededError when item count exceeds the limit', async () => {
    mockItemCount = String(DEFAULT_MAX_ITEMS_PER_LIST + 10);
    await expect(checkItemQuota('list_xyz', 'org_abc')).rejects.toThrow(QuotaExceededError);
  });

  it('error uses scope=list_items and correct current/limit', async () => {
    mockItemCount = String(DEFAULT_MAX_ITEMS_PER_LIST);

    const err = await checkItemQuota('list_xyz', 'org_abc').catch((e: QuotaExceededError) => e);

    expect(err).toBeInstanceOf(QuotaExceededError);
    if (err instanceof QuotaExceededError) {
      expect(err.scope).toBe('list_items');
      expect(err.current).toBe(DEFAULT_MAX_ITEMS_PER_LIST);
      expect(err.limit).toBe(DEFAULT_MAX_ITEMS_PER_LIST);
    }
  });

  it('respects per-org override for item limit', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: null,
      max_lists_per_user: null,
      max_items_per_list: 10,
      max_locales: null,
    };
    mockItemCount = '10'; // at the override limit

    await expect(checkItemQuota('list_xyz', 'org_abc')).rejects.toThrow(QuotaExceededError);
  });
});

// ─── getQuotaUsage ────────────────────────────────────────────────────────────

describe('getQuotaUsage', () => {
  beforeEach(resetMocks);

  it('returns a QuotaUsage with exactly 4 quota entries', async () => {
    const result = await getQuotaUsage('org_abc');

    expect(result.organization_id).toBe('org_abc');
    expect(result.quotas).toHaveLength(4);
  });

  it('first entry is org_lists with correct limit and current count', async () => {
    mockListCount = '12';

    const result = await getQuotaUsage('org_abc');

    const orgLists = result.quotas[0];
    expect(orgLists.scope).toBe('org_lists');
    expect(orgLists.applies_to).toBe('organization');
    expect(orgLists.limit).toBe(DEFAULT_MAX_LISTS);
    expect(orgLists.current).toBe(12);
  });

  it('second entry is user_lists with current=0 when no userId supplied', async () => {
    const result = await getQuotaUsage('org_abc');

    const userLists = result.quotas[1];
    expect(userLists.scope).toBe('user_lists');
    expect(userLists.applies_to).toBe('user');
    expect(userLists.limit).toBe(DEFAULT_MAX_LISTS_PER_USER);
    expect(userLists.current).toBe(0);
  });

  it('second entry is user_lists with correct count when userId is supplied', async () => {
    mockUserListCount = '3';

    const result = await getQuotaUsage('org_abc', 'usr_user1');

    const userLists = result.quotas[1];
    expect(userLists.scope).toBe('user_lists');
    expect(userLists.current).toBe(3);
  });

  it('third entry is list_items with current=null (per-list ceiling)', async () => {
    const result = await getQuotaUsage('org_abc');

    const listItems = result.quotas[2];
    expect(listItems.scope).toBe('list_items');
    expect(listItems.applies_to).toBe('list');
    expect(listItems.limit).toBe(DEFAULT_MAX_ITEMS_PER_LIST);
    expect(listItems.current).toBeNull();
  });

  it('fourth entry is list_locales with current=null (per-list ceiling)', async () => {
    const result = await getQuotaUsage('org_abc');

    const listLocales = result.quotas[3];
    expect(listLocales.scope).toBe('list_locales');
    expect(listLocales.applies_to).toBe('list');
    expect(listLocales.limit).toBe(DEFAULT_MAX_LOCALES);
    expect(listLocales.current).toBeNull();
  });

  it('applies per-org overrides to all four entries', async () => {
    mockQuotaRow = {
      organization_id: 'org_abc',
      max_lists: 50,
      max_lists_per_user: 5,
      max_items_per_list: 200,
      max_locales: 4,
    };
    mockListCount = '7';
    mockUserListCount = '2';

    const result = await getQuotaUsage('org_abc', 'usr_user1');

    expect(result.quotas[0].limit).toBe(50);
    expect(result.quotas[0].current).toBe(7);
    expect(result.quotas[1].limit).toBe(5);
    expect(result.quotas[1].current).toBe(2);
    expect(result.quotas[2].limit).toBe(200);
    expect(result.quotas[2].current).toBeNull();
    expect(result.quotas[3].limit).toBe(4);
    expect(result.quotas[3].current).toBeNull();
  });
});
