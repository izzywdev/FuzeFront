import { describe, expect, it } from 'vitest'
import {
  EffectiveLookupIncompleteError,
  classifyApiError,
  classifyMutationError,
  forkOutcomeFromFailure,
  isAbortError,
  restoreOutcomeFromFailure,
  visibilityOutcomeFromFailure,
} from './errors'
import type { ApiFailure } from './types'
import { COMMON_ID, requestError } from '../../test/sharedListsFixtures'

const ON = { sharedLists: true }
const OFF = { sharedLists: false }

describe('classifyApiError — the code, not the status alone', () => {
  it('401 is unauthenticated', () => {
    expect(
      classifyApiError(requestError(401, { code: 'UNAUTHENTICATED' }), ON)
    ).toEqual({
      kind: 'unauthenticated',
    })
  })

  it('403 FORBIDDEN is a permission, never a quota', () => {
    expect(
      classifyApiError(requestError(403, { code: 'FORBIDDEN' }), ON)
    ).toEqual({ kind: 'forbidden' })
  })

  it('403 QUOTA_EXCEEDED is a quota with its scope, limit and current', () => {
    expect(
      classifyApiError(
        requestError(403, {
          code: 'QUOTA_EXCEEDED',
          scope: 'org_lists',
          limit: 100,
          current: 100,
        }),
        ON
      )
    ).toEqual({ kind: 'quota', scope: 'org_lists', limit: 100, current: 100 })
  })

  it('passes an unknown quota scope through untouched', () => {
    expect(
      classifyApiError(
        requestError(403, { code: 'QUOTA_EXCEEDED', scope: 'something_new' }),
        ON
      )
    ).toEqual({
      kind: 'quota',
      scope: 'something_new',
      limit: undefined,
      current: undefined,
    })
  })

  it('ignores a non-numeric limit / current and a non-string scope', () => {
    expect(
      classifyApiError(
        requestError(403, {
          code: 'QUOTA_EXCEEDED',
          scope: 7,
          limit: '5',
          current: null,
        }),
        ON
      )
    ).toEqual({
      kind: 'quota',
      scope: undefined,
      limit: undefined,
      current: undefined,
    })
  })

  it('404 is not_found', () => {
    expect(
      classifyApiError(requestError(404, { code: 'NOT_FOUND' }), ON)
    ).toEqual({ kind: 'not_found' })
  })

  it('400 is validation, with its field details when present', () => {
    const details = [
      { field: '/visibility', message: 'must be one of private, org' },
    ]
    expect(
      classifyApiError(
        requestError(400, { code: 'VALIDATION_ERROR', details }),
        ON
      )
    ).toEqual({
      kind: 'validation',
      details,
    })
    expect(
      classifyApiError(requestError(400, { code: 'VALIDATION_ERROR' }), ON)
    ).toEqual({
      kind: 'validation',
      details: undefined,
    })
  })

  it('falls back to the status for a body with no contract code (an ingress page)', () => {
    expect(
      classifyApiError(requestError(403, { code: 'UNKNOWN' }), ON)
    ).toEqual({ kind: 'forbidden' })
    expect(classifyApiError(requestError(404, {}), ON)).toEqual({
      kind: 'not_found',
    })
    expect(classifyApiError(requestError(401, {}), ON)).toEqual({
      kind: 'unauthenticated',
    })
    expect(classifyApiError(requestError(400, {}), ON)).toMatchObject({
      kind: 'validation',
    })
    expect(classifyApiError(requestError(409, {}), ON)).toEqual({
      kind: 'conflict',
      reason: undefined,
    })
  })

  it('never reads the message', () => {
    expect(
      classifyApiError(
        requestError(403, {
          code: 'FORBIDDEN',
          message: 'quota exceeded for org',
        }),
        ON
      )
    ).toEqual({ kind: 'forbidden' })
  })

  it('a status the contract does not define is unknown (not a guess), as is any 5xx', () => {
    expect(classifyApiError(requestError(418, {}), ON)).toEqual({
      kind: 'unknown',
      status: 418,
      network: false,
    })
    expect(
      classifyApiError(requestError(502, { code: 'CONFLICT' }), ON)
    ).toEqual({
      kind: 'unknown',
      status: 502,
      network: false,
    })
    expect(classifyApiError(requestError(500, {}), ON)).toEqual({
      kind: 'unknown',
      status: 500,
      network: false,
    })
  })

  it('a failure with no HTTP status at all is a network failure', () => {
    expect(classifyApiError(new TypeError('Failed to fetch'), ON)).toEqual({
      kind: 'unknown',
      status: undefined,
      network: true,
    })
    expect(classifyApiError(undefined, ON)).toEqual({
      kind: 'unknown',
      status: undefined,
      network: true,
    })
    expect(classifyApiError('boom', OFF)).toEqual({
      kind: 'unknown',
      status: undefined,
      network: true,
    })
  })
})

describe('classifyApiError — 409 and fork_required (frame 04)', () => {
  const forkRequired = (extra: Record<string, unknown> = {}) =>
    requestError(409, {
      code: 'CONFLICT',
      reason: 'fork_required',
      source_list_id: COMMON_ID,
      fork_url: `/v1/selection-lists/${COMMON_ID}/fork`,
      ...extra,
    })

  it('409 fork_required carries the REFUSED list id and a relative fork url', () => {
    expect(classifyApiError(forkRequired(), ON)).toEqual({
      kind: 'fork_required',
      sourceListId: COMMON_ID,
      forkUrl: `/v1/selection-lists/${COMMON_ID}/fork`,
    })
  })

  it('ignores an absolute fork_url (the client forks through its own forkList(sourceListId))', () => {
    expect(
      classifyApiError(
        forkRequired({ fork_url: 'https://evil.example/fork' }),
        ON
      )
    ).toEqual({
      kind: 'fork_required',
      sourceListId: COMMON_ID,
      forkUrl: undefined,
    })
    expect(
      classifyApiError(forkRequired({ fork_url: '//evil.example/fork' }), ON)
    ).toMatchObject({
      forkUrl: undefined,
    })
  })

  it('fork_url may be absent: the CTA does not need it', () => {
    expect(
      classifyApiError(forkRequired({ fork_url: undefined }), ON)
    ).toMatchObject({
      kind: 'fork_required',
      forkUrl: undefined,
    })
  })

  it('a fork_required with no source_list_id cannot be forked from: it is a plain conflict', () => {
    expect(
      classifyApiError(forkRequired({ source_list_id: undefined }), ON)
    ).toEqual({
      kind: 'conflict',
      reason: 'fork_required',
    })
    expect(
      classifyApiError(forkRequired({ source_list_id: '' }), ON)
    ).toMatchObject({ kind: 'conflict' })
    expect(
      classifyApiError(forkRequired({ source_list_id: 7 }), ON)
    ).toMatchObject({ kind: 'conflict' })
  })

  it('with the flag OFF a stray fork_required is an ordinary conflict — no fork banner', () => {
    expect(classifyApiError(forkRequired(), OFF)).toEqual({
      kind: 'conflict',
      reason: 'fork_required',
    })
  })

  it('a 409 without a reason is the ordinary conflict', () => {
    expect(
      classifyApiError(requestError(409, { code: 'CONFLICT' }), ON)
    ).toEqual({
      kind: 'conflict',
      reason: undefined,
    })
  })

  it('403 never offers a fork, even with a source_list_id in the body', () => {
    expect(
      classifyApiError(
        requestError(403, {
          code: 'FORBIDDEN',
          reason: 'fork_required',
          source_list_id: COMMON_ID,
        }),
        ON
      )
    ).toEqual({ kind: 'forbidden' })
  })

  it('a non-string reason is ignored', () => {
    expect(
      classifyApiError(requestError(409, { code: 'CONFLICT', reason: 5 }), ON)
    ).toEqual({
      kind: 'conflict',
      reason: undefined,
    })
  })

  it('classifyMutationError is the same decision, with the flag as a plain boolean', () => {
    expect(classifyMutationError(forkRequired(), true)).toMatchObject({
      kind: 'fork_required',
    })
    expect(classifyMutationError(forkRequired(), false)).toMatchObject({
      kind: 'conflict',
    })
  })
})

describe('forkOutcomeFromFailure (frame 06 rows)', () => {
  const conflict = (reason?: string): ApiFailure => ({
    kind: 'conflict',
    reason,
  })

  it('409 fork_exists / fork_not_applicable are their own answers', () => {
    expect(forkOutcomeFromFailure(conflict('fork_exists'))).toEqual({
      kind: 'fork_exists',
    })
    expect(forkOutcomeFromFailure(conflict('fork_not_applicable'))).toEqual({
      kind: 'fork_not_applicable',
    })
  })

  it('409 with no reason, or one this UI does not know, is "key taken"', () => {
    expect(forkOutcomeFromFailure(conflict())).toEqual({ kind: 'key_taken' })
    expect(forkOutcomeFromFailure(conflict('something_new'))).toEqual({
      kind: 'key_taken',
    })
  })

  it('a (nonsensical) fork_required from the fork operation degrades to key taken', () => {
    expect(
      forkOutcomeFromFailure({
        kind: 'fork_required',
        sourceListId: COMMON_ID,
        forkUrl: undefined,
      })
    ).toEqual({ kind: 'key_taken' })
  })

  it('403 quota keeps scope / limit / current', () => {
    expect(
      forkOutcomeFromFailure({
        kind: 'quota',
        scope: 'list_items',
        limit: 250,
        current: 312,
      })
    ).toEqual({ kind: 'quota', scope: 'list_items', limit: 250, current: 312 })
  })

  it('400 is the size cap; 403 is no-create; 404 and 401 map across', () => {
    expect(
      forkOutcomeFromFailure({ kind: 'validation', details: undefined })
    ).toEqual({ kind: 'too_large' })
    expect(forkOutcomeFromFailure({ kind: 'forbidden' })).toEqual({
      kind: 'forbidden',
    })
    expect(forkOutcomeFromFailure({ kind: 'not_found' })).toEqual({
      kind: 'not_found',
    })
    expect(forkOutcomeFromFailure({ kind: 'unauthenticated' })).toEqual({
      kind: 'unauthenticated',
    })
  })

  it('network failure and 5xx are an UNKNOWN outcome (retry is safe)', () => {
    expect(
      forkOutcomeFromFailure({
        kind: 'unknown',
        status: undefined,
        network: true,
      })
    ).toEqual({
      kind: 'unknown_outcome',
      status: undefined,
    })
    expect(
      forkOutcomeFromFailure({ kind: 'unknown', status: 503, network: false })
    ).toEqual({
      kind: 'unknown_outcome',
      status: 503,
    })
  })
})

describe('restoreOutcomeFromFailure', () => {
  it('maps every failure to a restore answer', () => {
    expect(
      restoreOutcomeFromFailure({
        kind: 'quota',
        scope: 'user_lists',
        limit: 25,
        current: 25,
      })
    ).toEqual({
      kind: 'quota',
      scope: 'user_lists',
      limit: 25,
      current: 25,
    })
    expect(restoreOutcomeFromFailure({ kind: 'forbidden' })).toEqual({
      kind: 'forbidden',
    })
    expect(restoreOutcomeFromFailure({ kind: 'unauthenticated' })).toEqual({
      kind: 'unauthenticated',
    })
    expect(restoreOutcomeFromFailure({ kind: 'not_found' })).toEqual({
      kind: 'not_found',
    })
    expect(
      restoreOutcomeFromFailure({
        kind: 'fork_required',
        sourceListId: COMMON_ID,
        forkUrl: '/v1/x',
      })
    ).toEqual({
      kind: 'fork_required',
      sourceListId: COMMON_ID,
      forkUrl: '/v1/x',
    })
    expect(
      restoreOutcomeFromFailure({ kind: 'conflict', reason: 'x' })
    ).toEqual({ kind: 'conflict', reason: 'x' })
    expect(
      restoreOutcomeFromFailure({ kind: 'validation', details: undefined })
    ).toEqual({
      kind: 'unknown_outcome',
      status: 400,
    })
    expect(
      restoreOutcomeFromFailure({
        kind: 'unknown',
        status: 500,
        network: false,
      })
    ).toEqual({
      kind: 'unknown_outcome',
      status: 500,
    })
  })
})

describe('visibilityOutcomeFromFailure (frame 08)', () => {
  it('409 visibility_locked is locked; any other conflict stays a conflict', () => {
    expect(
      visibilityOutcomeFromFailure(
        { kind: 'conflict', reason: 'visibility_locked' },
        'private'
      )
    ).toEqual({
      kind: 'locked',
    })
    expect(
      visibilityOutcomeFromFailure(
        { kind: 'conflict', reason: undefined },
        'org'
      )
    ).toEqual({
      kind: 'conflict',
      reason: undefined,
    })
  })

  it('403 echoes the requested visibility so the copy can tell publish from not-owner', () => {
    expect(
      visibilityOutcomeFromFailure({ kind: 'forbidden' }, 'platform')
    ).toEqual({
      kind: 'forbidden',
      requested: 'platform',
    })
    expect(
      visibilityOutcomeFromFailure({ kind: 'forbidden' }, 'private')
    ).toEqual({
      kind: 'forbidden',
      requested: 'private',
    })
  })

  it('maps the remaining failures', () => {
    expect(
      visibilityOutcomeFromFailure({ kind: 'unauthenticated' }, 'org')
    ).toEqual({ kind: 'unauthenticated' })
    expect(visibilityOutcomeFromFailure({ kind: 'not_found' }, 'org')).toEqual({
      kind: 'not_found',
    })
    expect(
      visibilityOutcomeFromFailure(
        { kind: 'validation', details: undefined },
        'org'
      )
    ).toEqual({
      kind: 'validation',
      details: undefined,
    })
    expect(
      visibilityOutcomeFromFailure(
        { kind: 'fork_required', sourceListId: COMMON_ID, forkUrl: undefined },
        'org'
      )
    ).toEqual({
      kind: 'fork_required',
      sourceListId: COMMON_ID,
      forkUrl: undefined,
    })
    expect(
      visibilityOutcomeFromFailure(
        {
          kind: 'quota',
          scope: undefined,
          limit: undefined,
          current: undefined,
        },
        'org'
      )
    ).toEqual({
      kind: 'unknown_outcome',
      status: 403,
    })
    expect(
      visibilityOutcomeFromFailure(
        { kind: 'unknown', status: 500, network: false },
        'org'
      )
    ).toEqual({
      kind: 'unknown_outcome',
      status: 500,
    })
  })
})

describe('an incomplete effective-list lookup', () => {
  const incomplete = new EffectiveLookupIncompleteError(10)

  it('is its own failure kind — not unknown, not "none"', () => {
    expect(classifyApiError(incomplete, ON)).toEqual({ kind: 'incomplete' })
    expect(classifyApiError(incomplete, OFF)).toEqual({ kind: 'incomplete' })
  })

  it('carries the page count and is an Error', () => {
    expect(incomplete).toBeInstanceOf(Error)
    expect(incomplete.pages).toBe(10)
    expect(incomplete.incomplete).toBe(true)
  })

  it('maps to an unknown outcome wherever an outcome is needed (it cannot arise there)', () => {
    expect(forkOutcomeFromFailure({ kind: 'incomplete' })).toEqual({
      kind: 'unknown_outcome',
      status: undefined,
    })
    expect(restoreOutcomeFromFailure({ kind: 'incomplete' })).toEqual({
      kind: 'unknown_outcome',
      status: undefined,
    })
    expect(visibilityOutcomeFromFailure({ kind: 'incomplete' }, 'org')).toEqual(
      { kind: 'unknown_outcome', status: undefined }
    )
  })
})

describe('isAbortError', () => {
  it('recognises an AbortError by name only', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(
      isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))
    ).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
