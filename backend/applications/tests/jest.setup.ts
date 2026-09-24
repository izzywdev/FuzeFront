// FFRNT-185: dual-accept windows closed; no legacyUuidTypes needed.
import { configureIdentity } from '@izzywdev/fuzefront-identity'

configureIdentity({ legacyUuidTypes: new Set() })
