// Re-augments vitest's Assertion interface from THIS package's local resolution
// context so TypeScript sees the jest-dom matchers against vitest@2.x (nested in
// packages/identity-ui/node_modules), not the hoisted vitest@1.x at root.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/types/matchers'

declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
