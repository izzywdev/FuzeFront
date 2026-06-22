// The `/vitest` entrypoint both registers the matchers at runtime AND augments
// vitest's `Assertion` interface (`declare module 'vitest'`), so `tsc --noEmit`
// over the test files recognises `toBeInTheDocument` and friends.
import '@testing-library/jest-dom/vitest'
