import '@testing-library/jest-dom/vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/types/matchers'

// Inline augmentation from THIS file's location so TypeScript (resolving via the
// paths override in tsconfig.json) targets the LOCAL vitest@2.x install, not the
// root vitest@1.x that @testing-library/jest-dom's own vitest.d.ts augments.
declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}

declare module '@vitest/expect' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
