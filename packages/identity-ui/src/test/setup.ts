// Pull jest-dom's vitest.d.ts into THIS compilation unit so TypeScript applies the
// tsconfig.json `paths` override when resolving `import 'vitest'` inside that file,
// directing it to the LOCAL vitest@2.x install rather than the root vitest@1.x that
// @testing-library/jest-dom would otherwise resolve to from its own package location.
/// <reference path="../../../../node_modules/@testing-library/jest-dom/types/vitest.d.ts" />
import '@testing-library/jest-dom/vitest'
