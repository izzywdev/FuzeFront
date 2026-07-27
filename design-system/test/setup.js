// See packages/identity-ui/src/test/setup.ts for why `expect` is imported
// from vitest HERE rather than relying on a global: @testing-library/jest-dom
// must extend the SAME vitest module instance the test files import, or the
// matchers never become visible.
import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);
