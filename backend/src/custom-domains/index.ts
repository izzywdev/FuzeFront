/**
 * Custom domains (FF-EPIC-16 / FFRNT-91) — FuzeFront's integration with
 * FuzeInfra's Custom Hostname API.
 *
 * Ships behind `fuzefront.platform.portal-domains` (release, default OFF),
 * itself under the `fuzefront.platform.multi-tenant-portals` master switch.
 */
export {
  CustomHostnameService,
  CustomDomainValidationError,
  CustomDomainsDisabledError,
  CustomHostnameApiError,
  assertAttachable,
  toDomainStatePatch,
  MANAGED_ZONES,
} from './customHostnameService'
export type {
  DomainStatePatch,
  DomainStateStore,
  RedirectUriRegistrar,
  CustomHostnameServiceDeps,
} from './customHostnameService'

export { createAuthentikRedirectRegistrar, callbackUri } from './authentikRedirect'

export { FLAGS, isCustomDomainsEnabled, setFlagClient } from './flags'
export type { FlagClientLike, FlagContext } from './flags'

export { createCustomHostnameClient } from './factory'
