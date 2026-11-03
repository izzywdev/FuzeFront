import { describe, expect, it } from 'vitest'
import {
  copiedValuesText,
  forkQuotaCopy,
  plural,
  restoreQuotaCopy,
  shortDate,
} from './copy'

const q = (scope: string | undefined, limit?: number, current?: number) => ({
  scope,
  limit,
  current,
})

describe('forkQuotaCopy — chosen by scope, numbers from limit/current', () => {
  it('org_lists names the organization and the counts', () => {
    const c = forkQuotaCopy(q('org_lists', 100, 100), 'Globex Freight')
    expect(c.title).toBe('Globex Freight has reached its list limit')
    expect(c.body).toContain('100 of 100 organization lists are in use')
    expect(c.body).toContain('Nothing was created.')
  })
  it('user_lists', () => {
    const c = forkQuotaCopy(q('user_lists', 25, 25), 'Globex')
    expect(c.body).toContain('(25 of 25)')
  })
  it('list_items puts the source count before the cap', () => {
    const c = forkQuotaCopy(q('list_items', 250, 312), 'Globex')
    expect(c.body).toMatch(/\(312\).*\(250\)/)
  })
  it('drops the numbers when the service sent none', () => {
    expect(forkQuotaCopy(q('org_lists'), 'G').body).not.toMatch(/ of /)
    expect(forkQuotaCopy(q('user_lists'), 'G').body).not.toMatch(/\(/)
    expect(forkQuotaCopy(q('list_items'), 'G').body).not.toMatch(/\(/)
  })
  it('an unknown or missing scope is the generic sentence', () => {
    for (const scope of ['something_new', undefined]) {
      expect(forkQuotaCopy(q(scope, 1, 1), 'G').body).toMatch(
        /^A limit was reached\./
      )
    }
  })
})

describe('restoreQuotaCopy — the fork stays archived; user_lists never says "you"', () => {
  it('org_lists', () => {
    const c = restoreQuotaCopy(q('org_lists', 100, 100), 'Globex')
    expect(c.body).toContain('100 of 100 organization lists are active')
    expect(c.body).toContain('The fork stays archived.')
  })
  it('user_lists counts the CREATOR and avoids the second person', () => {
    const c = restoreQuotaCopy(q('user_lists', 25, 25), 'Globex')
    expect(`${c.title} ${c.body}`).not.toMatch(/\byou('ve|r)?\b/i)
    expect(c.body).toContain('(25 of 25)')
  })
  it('numbers are optional and unknown scopes are generic', () => {
    expect(restoreQuotaCopy(q('org_lists'), 'G').body).not.toMatch(/ of /)
    expect(restoreQuotaCopy(q('user_lists'), 'G').body).not.toMatch(/\(/)
    expect(restoreQuotaCopy(q('x', 1, 1), 'G').body).toBe(
      'A limit was reached. The fork stays archived.'
    )
  })
})

describe('copiedValuesText', () => {
  it('breaks the loaded values into active / archived', () => {
    expect(copiedValuesText({ active: 4, archived: 1 }, 4)).toBe(
      '5 values (4 active, 1 archived)'
    )
  })
  it('brief drops the breakdown, and singular is singular', () => {
    expect(copiedValuesText({ active: 1, archived: 0 }, 1, true)).toBe('1 value')
  })
  it('falls back to the active count, then to a generic phrase', () => {
    expect(copiedValuesText(undefined, 4)).toBe('4 active values')
    expect(copiedValuesText(undefined, 1)).toBe('1 active value')
    expect(copiedValuesText(undefined, undefined)).toBe('Every value')
  })
})

describe('plural / shortDate', () => {
  it('plural', () => {
    expect(plural(1, 'value')).toBe('value')
    expect(plural(0, 'value')).toBe('values')
  })
  it('shortDate is a UTC "Sep 2", or undefined for nothing usable', () => {
    expect(shortDate('2026-09-02T23:30:00Z')).toBe('Sep 2')
    expect(shortDate(undefined)).toBeUndefined()
    expect(shortDate('not a date')).toBeUndefined()
  })
})
