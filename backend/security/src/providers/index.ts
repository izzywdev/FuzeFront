/**
 * Provider swap contracts (interfaces only). The FuzeFront Security API is
 * implemented purely against these; concrete provider implementations live in
 * `providers/<provider>/` and are the ONLY place a vendor is named.
 */
export * from './IdentityProvider';
export * from './AuthorizationProvider';
