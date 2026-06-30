/**
 * @fuzefront/feature-flags — OpenFeature-based feature flags for FuzeFront.
 *
 * The default entrypoint is the SERVER surface (Node services). Browser /
 * micro-frontend consumers import from `@fuzefront/feature-flags/web`.
 *
 * Public evaluation surface is OpenFeature; the Unleash provider is wrapped
 * behind it with graceful degradation to caller-supplied defaults.
 */
export {
  init,
  setContext,
  getBoolean,
  getString,
  getNumber,
  close,
} from './server';

export { toEvaluationContext } from './context';
export type { FuzeFlagsContext, FuzeFlagsOptions } from './types';
