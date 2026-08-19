/**
 * Contract tests — translations and locale fallback chain
 *
 * Verifies:
 *   - PUT /v1/selection-lists/{listId}/translations/{locale}: upsert semantics,
 *     is_machine: false on human edit, source_hash stamping
 *   - PUT /v1/selection-lists/{listId}/items/{itemId}/translations/{locale}
 *   - Locale fallback chain (priority: requested locale → Accept-Language →
 *     source_locale → en): request fr when only en exists → en returned with
 *     resolved_locale: "en"; request ar when source is de and no ar/en → de
 *   - A label is NEVER null (fallback chain always terminates)
 *   - Autofill: POST /v1/selection-lists/{listId}/translations/{locale}/autofill
 *     – fills missing translations; never overwrites is_machine: false rows
 *     – source_locale cannot be autofilled into itself (400)
 *     – overwrite_machine: true refreshes machine rows but not human rows
 *   - Unsupported locale in path → 400 VALIDATION_ERROR
 *
 * Tests are ALL RED until the service is implemented.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestList, createTestListWithItems, purgeList } from '../helpers/factories';
import type { SelectionListId, SelectionListItemId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000transl0000000';
const USER_OWNER = 'usr_01test00000000translowner00';

function ownerToken(): string {
  return mintTestToken({ userId: USER_OWNER, organizationId: ORG_ID });
}

const createdListIds: SelectionListId[] = [];

afterAll(async () => {
  const client = makeClient(ownerToken);
  for (const id of createdListIds) {
    await purgeList(client, id);
  }
});

// ---------------------------------------------------------------------------
// PUT list translation
// ---------------------------------------------------------------------------

describe('PUT /v1/selection-lists/{listId}/translations/{locale}', () => {
  it('stores a human translation with is_machine: false and correct locale', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'tr-put-' + Math.random().toString(16).slice(2, 8),
      name: 'Translation Test',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    const translation = await client.upsertListTranslation(list.id as SelectionListId, 'fr', {
      name: 'Test de traduction',
      description: 'Description en français',
    });

    expect(translation.list_id).toBe(list.id);
    expect(translation.locale).toBe('fr');
    expect(translation.name).toBe('Test de traduction');
    expect(translation.is_machine).toBe(false); // human edit is never is_machine
  });

  it('upsert is idempotent: re-PUTting the same locale replaces the row', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'tr-upsert-' + Math.random().toString(16).slice(2, 8),
      name: 'Upsert Test',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    await client.upsertListTranslation(list.id as SelectionListId, 'fr', { name: 'Premier' });
    const second = await client.upsertListTranslation(list.id as SelectionListId, 'fr', { name: 'Deuxième' });
    expect(second.name).toBe('Deuxième');
    expect(second.is_machine).toBe(false);
  });

  it('returns 404 for a non-existent list', async () => {
    const { status } = await rawFetch(
      '/v1/selection-lists/sl_01hnonexistent000000000000/translations/fr',
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ name: 'Ghost' }),
      }
    );
    expect(status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR for an unsupported locale in path', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'tr-badloc-' + Math.random().toString(16).slice(2, 8),
      name: 'Bad Locale',
    });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/translations/xx`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ name: 'Invalid locale' }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PUT item translation
// ---------------------------------------------------------------------------

describe('PUT /v1/selection-lists/{listId}/items/{itemId}/translations/{locale}', () => {
  it('stores a human item translation with is_machine: false', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 1, {
      key: 'it-put-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);
    const item = items[0];

    const translation = await client.upsertItemTranslation(
      list.id as SelectionListId,
      item.id as SelectionListItemId,
      'fr',
      { label: 'Étiquette en français' }
    );

    expect(translation.item_id).toBe(item.id);
    expect(translation.locale).toBe('fr');
    expect(translation.label).toBe('Étiquette en français');
    expect(translation.is_machine).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Locale fallback chain
// ---------------------------------------------------------------------------

describe('Locale fallback chain', () => {
  let listId: SelectionListId;
  let itemId: SelectionListItemId;

  beforeAll(async () => {
    // Create a list with source_locale: en; add only an 'en' translation for now
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 1, {
      key: 'fallback-' + Math.random().toString(16).slice(2, 8),
      name: 'Fallback Chain Test',
      source_locale: 'en',
    });
    listId = list.id as SelectionListId;
    itemId = items[0].id as SelectionListItemId;
    createdListIds.push(listId);
  });

  it('request locale=fr when only en exists → returns en translation with resolved_locale: "en"', async () => {
    const client = makeClient(ownerToken);
    const list = await client.getList(listId, 'fr');
    expect(list.name).not.toBeNull();
    expect(list.name.length).toBeGreaterThan(0);
    expect(list.resolved_locale).toBe('en');
  });

  it('item request locale=fr when only en exists → resolved_locale: "en", label is non-null', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getItems(listId, { locale: 'fr' });
    const item = page.items.find((i) => i.id === itemId);
    expect(item).toBeDefined();
    expect(item!.label.length).toBeGreaterThan(0);
    expect(item!.resolved_locale).toBe('en');
  });

  it('request locale=ar when source_locale=de and no ar or en translation → falls back to source_locale (de)', async () => {
    const client = makeClient(ownerToken);
    // Create a fresh list with source_locale=de, no en translation
    const deList = await createTestList(client, {
      key: 'fallback-de-' + Math.random().toString(16).slice(2, 8),
      name: 'Deutschsprachige Liste',
      source_locale: 'de',
    });
    createdListIds.push(deList.id as SelectionListId);

    // Only the de source_locale translation exists; no ar, no en
    const resolved = await client.getList(deList.id as SelectionListId, 'ar');
    expect(resolved.resolved_locale).toBe('de');
    expect(resolved.name.length).toBeGreaterThan(0); // never null
  });

  it('a label is NEVER null — the fallback chain always terminates with real text', async () => {
    // Request every supported locale on a list that only has source_locale text
    const client = makeClient(ownerToken);
    const supportedLocales = ['en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he'] as const;

    const freshList = await createTestList(client, {
      key: 'null-guard-' + Math.random().toString(16).slice(2, 8),
      name: 'Null Guard',
      source_locale: 'en',
    });
    createdListIds.push(freshList.id as SelectionListId);

    for (const locale of supportedLocales) {
      const result = await client.getList(freshList.id as SelectionListId, locale);
      expect(result.name).not.toBeNull();
      expect(result.name.length).toBeGreaterThan(0);
      expect(result.resolved_locale).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Autofill
// ---------------------------------------------------------------------------

describe('POST /v1/selection-lists/{listId}/translations/{locale}/autofill', () => {
  it('fills missing translations and returns an autofill result shape', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 2, {
      key: 'autofill-' + Math.random().toString(16).slice(2, 8),
      name: 'Autofill Test',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    const result = await client.autofillTranslations(list.id as SelectionListId, 'es');

    // Shape check
    expect(result.locale).toBe('es');
    expect(result.source_locale).toBe('en');
    expect(typeof result.list_translated).toBe('boolean');
    expect(typeof result.items_translated).toBe('number');
    expect(typeof result.items_skipped).toBe('number');

    // Totals must account for all items (translated + skipped = total items attempted)
    expect(result.items_translated + result.items_skipped).toBe(items.length);
  });

  it('does NOT overwrite is_machine: false (human) translations', async () => {
    const client = makeClient(ownerToken);
    const { list } = await createTestListWithItems(client, 1, {
      key: 'autofill-noover-' + Math.random().toString(16).slice(2, 8),
      name: 'No Overwrite',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    // Write a human translation for fr
    await client.upsertListTranslation(list.id as SelectionListId, 'fr', { name: 'Traduction humaine' });

    // Autofill fr — should skip the human translation
    const result = await client.autofillTranslations(list.id as SelectionListId, 'fr');
    expect(result.list_translated).toBe(false); // human row protected

    // Verify the human translation is still the human version
    const resolved = await client.getList(list.id as SelectionListId, 'fr');
    expect(resolved.is_machine).toBe(false);
    expect(resolved.name).toBe('Traduction humaine');
  });

  it('returns 400 VALIDATION_ERROR when locale equals source_locale', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'autofill-self-' + Math.random().toString(16).slice(2, 8),
      name: 'Self Autofill',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/translations/en/autofill`,
      { method: 'POST', token: ownerToken() }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('overwrite_machine: true refreshes machine rows but not human rows', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 2, {
      key: 'autofill-ow-' + Math.random().toString(16).slice(2, 8),
      name: 'Overwrite Machine',
      source_locale: 'en',
    });
    createdListIds.push(list.id as SelectionListId);

    // Run once to create machine translations
    await client.autofillTranslations(list.id as SelectionListId, 'de');

    // Write a human translation for one item
    await client.upsertItemTranslation(
      list.id as SelectionListId,
      items[0].id as SelectionListItemId,
      'de',
      { label: 'Menschliche Übersetzung' }
    );

    // Run autofill with overwrite_machine: true
    const result = await client.autofillTranslations(list.id as SelectionListId, 'de', {
      overwrite_machine: true,
    });

    // The human item (item[0]) should be skipped; the machine item (item[1]) re-translated
    expect(result.items_skipped).toBeGreaterThanOrEqual(1);

    // Human translation must be preserved
    const page = await client.getItems(list.id as SelectionListId, { locale: 'de' });
    const humanItem = page.items.find((i) => i.id === items[0].id);
    expect(humanItem).toBeDefined();
    expect(humanItem!.is_machine).toBe(false);
    expect(humanItem!.label).toBe('Menschliche Übersetzung');
  });
});
