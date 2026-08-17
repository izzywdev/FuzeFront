// Flows (route orchestrators — design/frames/config-management/manifest.json `build.flows`)
export { ConfigSettingsEditorFlow } from './components/editor/ConfigSettingsEditorFlow'
export type { ConfigSettingsEditorFlowProps, SecretRowState } from './components/editor/ConfigSettingsEditorFlow'
export { ConfigKeyCatalogFlow } from './components/catalog/ConfigKeyCatalogFlow'
export type { ConfigKeyCatalogFlowProps, CatalogFilter } from './components/catalog/ConfigKeyCatalogFlow'
export { ConfigSecretAuditFlow } from './components/audit/ConfigSecretAuditFlow'
export type { ConfigSecretAuditFlowProps, AuditEntry, AuditOperation } from './components/audit/ConfigSecretAuditFlow'

// Catalog sub-view
export { KeyDefinitionDetail } from './components/catalog/KeyDefinitionDetail'
export type { KeyDefinitionDetailProps, ChainStep } from './components/catalog/KeyDefinitionDetail'

// Editor building blocks (exported for hosts that need finer control / composition)
export { SettingRow } from './components/editor/SettingRow'
export type { SettingRowProps } from './components/editor/SettingRow'
export { TypedValueInput } from './components/editor/TypedValueInput'
export { ResetValueMenu } from './components/editor/ResetValueMenu'
export { SecretField } from './components/editor/SecretField'
export { SaveBar } from './components/editor/SaveBar'
export { VersionConflictResolver } from './components/editor/VersionConflictResolver'
export type { ConflictEntry } from './components/editor/VersionConflictResolver'

// Common
export { ProvenanceBadge } from './components/common/ProvenanceBadge'
export { ScopeChainSwitcher } from './components/common/ScopeChainSwitcher'
export { ErrorCodeTag } from './components/common/ErrorCodeTag'

// Lib
export { deriveProvenance, formatScope, isAncestorOrSame } from './lib/provenance'
export type { ProvenanceKind } from './lib/provenance'

// i18n
export { ConfigI18nProvider, useConfigI18n } from './i18n/ConfigI18nProvider'
export type { ConfigLocale } from './i18n/ConfigI18nProvider'
export type { ConfigMessages } from './i18n/messages'

// Types
export type { ScopeNameResolver, ScopeChainStep } from './types'
