// Flag clients for the route suites that mock the database.
//
// The 4.0.0-era suites (lists/items/translations/failure-containment/route-matrix) pin the behaviour of the
// service with `fuzefront.selection-lists.shared-lists` OFF (the default: exactly the 4.0.0 behaviour, and the
// DB call sequences their mocked knex is scripted for); the shared-lists behaviour has its own suites that
// pin it ON. A blanket `getBooleanValue: async () => true` would silently turn the new flag ON in them.

export const SHARED_LISTS_FLAG = 'fuzefront.selection-lists.shared-lists';

/** Every flag ON except the shared-lists release flag. */
export const allFlagsExceptShared = async (key: string): Promise<boolean> => key !== SHARED_LISTS_FLAG;

/** Every flag ON, including the shared-lists release flag. */
export const allFlagsOn = async (): Promise<boolean> => true;

/** Master gate ON; shared-lists as given. */
export const flagClientWith = (shared: boolean) => ({
  getBooleanValue: async (key: string): Promise<boolean> => (key === SHARED_LISTS_FLAG ? shared : true),
});
