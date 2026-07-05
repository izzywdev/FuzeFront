import { describe, it, expect } from 'vitest'
import { parseEmailText, parseCsv, isValidEmail } from './parseEmails'

describe('isValidEmail', () => {
  it('accepts a normal address and rejects junk', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })
})

describe('parseEmailText', () => {
  it('splits on newlines, commas and semicolons, trimming + deduping', () => {
    const result = parseEmailText('a@b.co\n d@e.fg ; a@b.co , bad')
    expect(result.map((r) => r.email)).toEqual(['a@b.co', 'd@e.fg', 'bad'])
    expect(result.find((r) => r.email === 'bad')!.valid).toBe(false)
  })
})

describe('parseCsv', () => {
  it('detects an email column by header', () => {
    const csv = 'name,email,role\nAlice,alice@ex.com,admin\nBob,bob@ex.com,member'
    const result = parseCsv(csv)
    expect(result.map((r) => r.email)).toEqual(['alice@ex.com', 'bob@ex.com'])
    expect(result.every((r) => r.valid)).toBe(true)
  })

  it('falls back to the first column when no header', () => {
    const csv = 'alice@ex.com\nbob@ex.com'
    const result = parseCsv(csv)
    expect(result.map((r) => r.email)).toEqual(['alice@ex.com', 'bob@ex.com'])
  })

  it('handles quoted fields and a BOM', () => {
    const csv = '﻿email,note\n"quoted@ex.com","has, comma"'
    const result = parseCsv(csv)
    expect(result[0].email).toBe('quoted@ex.com')
  })

  it('flags invalid rows', () => {
    const csv = 'email\nnot-an-email\ngood@ex.com'
    const result = parseCsv(csv)
    expect(result.find((r) => r.email === 'not-an-email')!.valid).toBe(false)
    expect(result.find((r) => r.email === 'good@ex.com')!.valid).toBe(true)
  })
})
