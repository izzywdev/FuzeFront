// Configure the identity dual-accept window before any test runs.
// Existing rows carry bare UUIDs (not TypeIDs yet); parseId/assertRef must
// accept them during the P3 backfill window. Remove when backfill ships.
import { configureIdentity } from '@izzywdev/fuzefront-identity'

configureIdentity({
  legacyUuidTypes: new Set(['organization', 'user', 'portal']),
})
