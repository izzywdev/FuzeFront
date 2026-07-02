// Re-augments the vitest Assertion interface from THIS package's local resolution
// context. In vitest 1.x, Assertion is declared in 'vitest'; in vitest 2.x it is
// declared in '@vitest/expect' and merely re-exported by 'vitest'. We augment both
// so jest-dom matchers are visible regardless of which vitest major is resolved.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/types/matchers'

declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}

declare module '@vitest/expect' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
