import { IncompatibleManifestError, reconcileKeyManifest } from '../../src/services/key-manifest.service';
import { KeyDefinition, NamespaceEntityId } from '../../src/types';

const NAMESPACE_ID = 'cns_x' as NamespaceEntityId;

function def(overrides: Partial<KeyDefinition> & Pick<KeyDefinition, 'id' | 'key'>): KeyDefinition {
  return {
    namespaceId: NAMESPACE_ID,
    displayName: overrides.key,
    description: null,
    helpUrl: null,
    category: null,
    sortOrder: 0,
    tags: [],
    valueType: 'string',
    schema: null,
    enumValues: null,
    defaultValue: 'x',
    allowedScopes: ['platform', 'portal', 'org', 'user'],
    isSystem: false,
    isHidden: false,
    isSecret: false,
    isReadonly: false,
    precedence: 'most-specific-wins',
    requiresRestart: false,
    deprecatedAt: null,
    replacedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('reconcileKeyManifest', () => {
  it('creates a key absent from the current catalog', async () => {
    const createDefinition = jest.fn(async (input) => def({ id: 'ckd_new' as any, key: input.key }));
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { keys: [{ key: 'ui.theme', displayName: 'Theme', valueType: 'string', defaultValue: 'light', allowedScopes: ['user'] }] },
      {
        listCurrent: async () => [],
        listStoredValues: async () => [],
        createDefinition,
        updateDefinition: jest.fn(),
        deprecateDefinitions: jest.fn(),
      },
    );
    expect(result.created).toEqual(['ui.theme']);
    expect(result.updated).toEqual([]);
    expect(createDefinition).toHaveBeenCalledTimes(1);
  });

  it('reports a key as unchanged (no write) when metadata matches exactly', async () => {
    const existing = def({ id: 'ckd_1' as any, key: 'ui.theme', defaultValue: 'light', allowedScopes: ['user'] });
    const updateDefinition = jest.fn();
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { keys: [{ key: 'ui.theme', displayName: 'ui.theme', valueType: 'string', defaultValue: 'light', allowedScopes: ['user'] }] },
      {
        listCurrent: async () => [existing],
        listStoredValues: async () => [],
        createDefinition: jest.fn(),
        updateDefinition,
        deprecateDefinitions: jest.fn(),
      },
    );
    expect(result.unchanged).toEqual(['ui.theme']);
    expect(updateDefinition).not.toHaveBeenCalled();
  });

  it('updates a key whose metadata differs (non-shape-changing edit)', async () => {
    const existing = def({ id: 'ckd_1' as any, key: 'ui.theme', displayName: 'Old label', defaultValue: 'light', allowedScopes: ['user'] });
    const updateDefinition = jest.fn(async (id, input) => def({ id, key: input.key }));
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { keys: [{ key: 'ui.theme', displayName: 'New label', valueType: 'string', defaultValue: 'light', allowedScopes: ['user'] }] },
      {
        listCurrent: async () => [existing],
        listStoredValues: async () => [],
        createDefinition: jest.fn(),
        updateDefinition,
        deprecateDefinitions: jest.fn(),
      },
    );
    expect(result.updated).toEqual(['ui.theme']);
    expect(updateDefinition).toHaveBeenCalledWith('ckd_1', expect.objectContaining({ displayName: 'New label' }));
  });

  it('revives a deprecated key that reappears in the manifest, even with identical metadata', async () => {
    const existing = def({
      id: 'ckd_1' as any,
      key: 'ui.theme',
      defaultValue: 'light',
      allowedScopes: ['user'],
      deprecatedAt: '2026-01-01T00:00:00.000Z',
    });
    const updateDefinition = jest.fn(async (id, input) => def({ id, key: input.key }));
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { keys: [{ key: 'ui.theme', displayName: 'ui.theme', valueType: 'string', defaultValue: 'light', allowedScopes: ['user'] }] },
      {
        listCurrent: async () => [existing],
        listStoredValues: async () => [],
        createDefinition: jest.fn(),
        updateDefinition,
        deprecateDefinitions: jest.fn(),
      },
    );
    expect(result.updated).toEqual(['ui.theme']);
    expect(updateDefinition).toHaveBeenCalledTimes(1);
  });

  it('deprecates keys omitted from a `complete` manifest, and never deletes', async () => {
    const stillDeclared = def({ id: 'ckd_1' as any, key: 'ui.theme', defaultValue: 'light', allowedScopes: ['user'] });
    const omitted = def({ id: 'ckd_2' as any, key: 'ui.legacy', defaultValue: 'x', allowedScopes: ['user'] });
    const deprecateDefinitions = jest.fn();
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { complete: true, keys: [{ key: 'ui.theme', displayName: 'ui.theme', valueType: 'string', defaultValue: 'light', allowedScopes: ['user'] }] },
      {
        listCurrent: async () => [stillDeclared, omitted],
        listStoredValues: async () => [],
        createDefinition: jest.fn(),
        updateDefinition: jest.fn(),
        deprecateDefinitions,
      },
    );
    expect(result.deprecated).toEqual(['ui.legacy']);
    expect(deprecateDefinitions).toHaveBeenCalledWith(['ckd_2']);
  });

  it('does NOT deprecate omitted keys when the manifest is not marked complete', async () => {
    const omitted = def({ id: 'ckd_2' as any, key: 'ui.legacy', defaultValue: 'x', allowedScopes: ['user'] });
    const deprecateDefinitions = jest.fn();
    const result = await reconcileKeyManifest(
      NAMESPACE_ID,
      { keys: [] },
      {
        listCurrent: async () => [omitted],
        listStoredValues: async () => [],
        createDefinition: jest.fn(),
        updateDefinition: jest.fn(),
        deprecateDefinitions,
      },
    );
    expect(result.deprecated).toEqual([]);
    expect(deprecateDefinitions).not.toHaveBeenCalled();
  });

  it('refuses a shape-incompatible change as a whole, applying NO writes at all, when a stored value would no longer validate', async () => {
    const existing = def({ id: 'ckd_1' as any, key: 'ui.mode', valueType: 'enum', enumValues: ['light', 'dark'], defaultValue: 'light', allowedScopes: ['user'] });
    const otherKeyToCreate = { key: 'ui.other', displayName: 'Other', valueType: 'string' as const, defaultValue: 'x', allowedScopes: ['user' as const] };
    const createDefinition = jest.fn();
    const updateDefinition = jest.fn();
    const deprecateDefinitions = jest.fn();

    await expect(
      reconcileKeyManifest(
        NAMESPACE_ID,
        {
          keys: [
            // Narrowing enumValues strands the stored 'dark' value.
            { key: 'ui.mode', displayName: 'ui.mode', valueType: 'enum', enumValues: ['light'], defaultValue: 'light', allowedScopes: ['user'] },
            otherKeyToCreate,
          ],
        },
        {
          listCurrent: async () => [existing],
          listStoredValues: async (definitionId) =>
            definitionId === existing.id ? [{ scopeType: 'org', value: 'dark' }] : [],
          createDefinition,
          updateDefinition,
          deprecateDefinitions,
        },
      ),
    ).rejects.toThrow(IncompatibleManifestError);

    // Nothing written: neither the incompatible update NOR the unrelated
    // create (which would have been fine on its own) is applied — batch
    // atomicity extends to the whole manifest, matching S6 AC3's "no key is
    // written" for PUT /v1/config.
    expect(createDefinition).not.toHaveBeenCalled();
    expect(updateDefinition).not.toHaveBeenCalled();
    expect(deprecateDefinitions).not.toHaveBeenCalled();
  });

  it('reports which stored values conflict, on the thrown error', async () => {
    const existing = def({ id: 'ckd_1' as any, key: 'ui.mode', valueType: 'enum', enumValues: ['light', 'dark'], defaultValue: 'light', allowedScopes: ['user'] });
    try {
      await reconcileKeyManifest(
        NAMESPACE_ID,
        { keys: [{ key: 'ui.mode', displayName: 'ui.mode', valueType: 'enum', enumValues: ['light'], defaultValue: 'light', allowedScopes: ['user'] }] },
        {
          listCurrent: async () => [existing],
          listStoredValues: async () => [{ scopeType: 'org', value: 'dark' }],
          createDefinition: jest.fn(),
          updateDefinition: jest.fn(),
          deprecateDefinitions: jest.fn(),
        },
      );
      fail('expected IncompatibleManifestError');
    } catch (err) {
      expect(err).toBeInstanceOf(IncompatibleManifestError);
      expect((err as InstanceType<typeof IncompatibleManifestError>).conflicts).toEqual([
        expect.objectContaining({ key: 'ui.mode' }),
      ]);
    }
  });
});
