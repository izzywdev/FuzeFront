/**
 * @fuzefront/security-client — public entrypoint.
 *
 * Re-exports the hand-authored stable contract types and the generated HTTP
 * types produced from `openapi.yaml` by `openapi-typescript`. UI, backend, and
 * tests all import from here so contract drift becomes a compile error.
 */
export * from './types';
export type { paths, components, operations } from './generated';
