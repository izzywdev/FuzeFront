import { describe, it, expect } from 'vitest'
import * as pkg from './index'
describe('identity-ui package', () => {
  it('module loads', () => { expect(pkg).toBeDefined() })
})
