/**
 * shared-lists/visibility — the visibility flow (frames 08, 14): change a list's
 * visibility private | org | platform. Host-facing surface: `VisibilityControl`
 * (mounted by the Access tab); the confirmations are internal building blocks
 * exported for composition and tests.
 */
export { VisibilityControl } from './VisibilityControl'
export type { AccessObservation, VisibilityControlProps } from './VisibilityControl'
export { PublishPlatformConfirm } from './PublishPlatformConfirm'
export type { PublishPlatformConfirmProps } from './PublishPlatformConfirm'
export { MakePrivateConfirm } from './MakePrivateConfirm'
export type { MakePrivateConfirmProps } from './MakePrivateConfirm'
export { COMPACT_QUERY, useCompactViewport } from './useCompactViewport'
