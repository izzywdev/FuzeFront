/// <reference path="../../../../node_modules/@testing-library/jest-dom/types/vitest.d.ts" />
import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
