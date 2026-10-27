// list-shape.revision.test.ts — formatList emits `revision` (openapi 4.2.0) in BOTH states of the shared-lists
// flag; BIGINT strings from pg render as integers (design record 13.4 item 5).

import { formatList, ListRow } from '../src/routes/listShape';

const row = (over: Partial<ListRow> = {}): ListRow => ({
  id: 'front_sl_x',
  organization_id: 'org_x',
  key: 'k',
  source_locale: 'en',
  status: 'active',
  created_by: 'user_x',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  name: 'N',
  description: null,
  resolved_locale: 'en',
  is_machine: false,
  revision: 1,
  ...over,
});

describe('formatList revision', () => {
  it.each([
    ['flag OFF', { shared: false }],
    ['flag ON', { shared: true }],
    ['flag ON with editable', { shared: true, editable: true }],
  ])('emits revision %s', (_label, ctx) => {
    expect(formatList(row({ revision: 1 }), ctx).revision).toBe(1);
  });

  it('renders a BIGINT string as an integer number', () => {
    expect(formatList(row({ revision: '7' })).revision).toBe(7);
    expect(formatList(row({ revision: '7' }), { shared: true }).revision).toBe(7);
  });

  it('a fork reports its own revision, distinct from forked_from.revision', () => {
    const out = formatList(
      row({
        revision: '12',
        forked_from_list_id: 'front_sl_src',
        forked_from_org_id: 'org_platform',
        forked_from_revision: '3',
        forked_at: new Date('2026-10-02T00:00:00Z'),
      }),
      { shared: true },
    );
    expect(out.revision).toBe(12);
    expect(out.forked_from).toMatchObject({ list_id: 'front_sl_src', revision: 3 });
  });
});
