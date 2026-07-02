// @testing-library/jest-dom lives in root node_modules; its /vitest entry
// does `import { expect } from 'vitest'` which resolves to the ROOT
// vitest@1.x from that package's location — a different module instance
// than the LOCAL vitest@2.x that test files import.  Calling expect.extend()
// on the wrong instance means the matchers are never visible to tests.
//
// Fix: import `expect` from vitest HERE (Vite resolves this file's imports
// from packages/identity-ui/node_modules → local vitest@2.x), then extend
// that expect with the matchers object from jest-dom/matchers directly.
//
// The triple-slash reference brings jest-dom's vitest.d.ts into THIS
// compilation unit so TypeScript's `paths` override (tsconfig.json) redirects
// its `import 'vitest'` to local vitest@2.x, making the type augmentation
// (Assertion extends TestingLibraryMatchers) land on the right module.
/// <reference path="../../../../node_modules/@testing-library/jest-dom/types/vitest.d.ts" />
import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
