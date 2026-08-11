import {
  PgKeyDefinitionRepository,
  UnsatisfiableDefaultValueError,
} from '../../src/repositories/key-definition.repository';
import { NamespaceEntityId } from '../../src/types';

function fakePool(queryImpl?: jest.Mock) {
  return { query: queryImpl ?? jest.fn() } as any;
}

const NAMESPACE_ID = 'cns_01h455vb4pex5vsknk084sn02q' as NamespaceEntityId;
const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('PgKeyDefinitionRepository.create — S2 AC4: unsatisfiable defaults never enter the catalog', () => {
  it('rejects BEFORE any query when defaultValue fails the key\'s own schema, and mints no id', async () => {
    const query = jest.fn();
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    await expect(
      repo.create(NAMESPACE_ID, {
        key: 'ui.theme.mode',
        displayName: 'Theme mode',
        valueType: 'enum',
        enumValues: ['light', 'dark'],
        defaultValue: 'purple', // not in enumValues
        allowedScopes: ['user'],
      }),
    ).rejects.toThrow(UnsatisfiableDefaultValueError);

    expect(query).not.toHaveBeenCalled();
  });

  it('inserts and mints a ckd_ id when the default is self-consistent', async () => {
    let capturedParams: unknown[] = [];
    const query = jest.fn(async (_sql: string, params: unknown[]) => {
      capturedParams = params;
      return {
        rows: [
          {
            id: params[0],
            namespace_id: params[1],
            key: params[2],
            display_name: params[3],
            description: params[4],
            help_url: params[5],
            category: params[6],
            sort_order: params[7],
            tags: [],
            value_type: params[9],
            schema: null,
            enum_values: JSON.parse(params[11] as string),
            default_value: JSON.parse(params[12] as string),
            allowed_scopes: params[13],
            is_system: params[14],
            is_hidden: params[15],
            is_secret: params[16],
            is_readonly: params[17],
            precedence: params[18],
            requires_restart: params[19],
            deprecated_at: null,
            replaced_by: params[20],
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      };
    });
    const repo = new PgKeyDefinitionRepository(fakePool(query));

    const created = await repo.create(NAMESPACE_ID, {
      key: 'ui.theme.mode',
      displayName: 'Theme mode',
      valueType: 'enum',
      enumValues: ['light', 'dark'],
      defaultValue: 'light',
      allowedScopes: ['user', 'org'],
    });

    expect(created.id).toMatch(/^ckd_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(created.key).toBe('ui.theme.mode');
    expect(created.defaultValue).toBe('light');
    // No id was accepted from the caller — capturedParams[0] is the
    // service-minted uuid, never something the input carried (KeyDefinitionInput
    // has no `id` field at all, enforced at the type level).
    expect(capturedParams[0]).toBeDefined();
  });
});
