import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'

// Register the jest-dom matchers explicitly rather than via the
// '@testing-library/jest-dom/vitest' side-effect entry. That entry resolves
// `vitest` relative to the hoisted root node_modules copy (vitest 1.x), while
// this package runs on its own nested vitest 3.x — so it extended a different
// `expect` and every matcher failed with "Invalid Chai property:
// toBeInTheDocument". Extending the locally-imported `expect` is
// hoisting-independent.
expect.extend(jestDomMatchers)

afterEach(() => {
  cleanup()
  // Reset document direction/lang between tests so RTL assertions are isolated.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.removeAttribute('dir')
    document.documentElement.removeAttribute('lang')
  }
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
