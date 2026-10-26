/**
 * Client projection of contract 4.2.0: `SelectionList.revision` and the
 * fork-vs-source comparison.
 *
 * Verifies only how the client surfaces the field and what the helper answers
 * — never the service's behaviour.
 */
import { describe, expect, it } from 'vitest'
import {
  SelectionListClient,
  compareForkToSource,
  type SelectionList,
} from '../src/index'

const SOURCE_ID = 'front_sl_01h455vb4pex5vsknk084sn02q'
const FORK_ID = 'front_sl_01h455vb4pex5vsknk084sn03r'
const NOW = '2026-10-05T12:00:00Z'

const SOURCE: SelectionList = {
  id: SOURCE_ID,
  organization_id: 'org_01h455vb4pex5vsknk084sn0pf',
  key: 'priority',
  source_locale: 'en',
  status: 'active',
  name: 'Priority',
  resolved_locale: 'en',
  is_machine: false,
  seed: null,
  visibility: 'platform',
  forked_from: null,
  editable: false,
  revision: 9,
  created_by: 'system:platform',
  created_at: NOW,
  updated_at: NOW,
}

const FORK: SelectionList = {
  ...SOURCE,
  id: FORK_ID,
  organization_id: 'org_01h455vb4pex5vsknk084sn02q',
  visibility: 'org',
  editable: true,
  revision: 12,
  forked_from: {
    list_id: SOURCE_ID,
    organization_id: 'org_01h455vb4pex5vsknk084sn0pf',
    revision: 7,
    forked_at: NOW,
  },
  created_by: 'usr_01h455vb4pex5vsknk084sn02q',
}

function clientReturning(payload: unknown): SelectionListClient {
  const fakeFetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  return new SelectionListClient({ baseUrl: 'http://client.invalid', token: 't', fetch: fakeFetch })
}

describe('contract 4.2.0 — SelectionList.revision', () => {
  it('surfaces revision from a list response', async () => {
    const sl = await clientReturning(SOURCE).getList(SOURCE_ID)
    expect(sl.revision).toBe(9)
  })

  it('a 4.1.0-shaped list (no revision) is a valid SelectionList; absence stays unknown', async () => {
    const { revision: _r, ...asOf410 } = SOURCE
    const legacy: SelectionList = asOf410
    const sl = await clientReturning(legacy).getList(SOURCE_ID)
    expect(sl.revision).toBeUndefined()
    expect(compareForkToSource(FORK, sl)).toBe('unknown')
  })
})

describe('compareForkToSource', () => {
  it('source revision greater than the copied revision → behind', () => {
    expect(compareForkToSource(FORK, SOURCE)).toBe('behind')
  })

  it('equal revisions → up-to-date', () => {
    expect(compareForkToSource(FORK, { ...SOURCE, revision: 7 })).toBe('up-to-date')
  })

  it("compares the fork's provenance, never the fork's own revision", () => {
    // The fork's own counter (12) is unrelated to its source's (9).
    expect(compareForkToSource({ ...FORK, revision: 1 }, SOURCE)).toBe('behind')
  })

  it.each([
    ['the list is not a fork', { forked_from: null }, SOURCE],
    ['forked_from absent (4.0.0 shape)', { forked_from: undefined }, SOURCE],
    ['the second list is not the source', FORK, { ...SOURCE, id: 'front_sl_01h455vb4pex5vsknk084sn04s' }],
    ['source revision absent', FORK, { ...SOURCE, revision: undefined }],
    ['source revision not a positive integer', FORK, { ...SOURCE, revision: 0 }],
    ['source revision lower (not a contract state)', FORK, { ...SOURCE, revision: 6 }],
  ] as const)('%s → unknown', (_label, fork, source) => {
    expect(compareForkToSource(fork as Pick<SelectionList, 'forked_from'>, source)).toBe('unknown')
  })

  it('never reads updated_at', () => {
    const newer = { ...SOURCE, revision: undefined, updated_at: '2030-01-01T00:00:00Z' }
    expect(compareForkToSource(FORK, newer)).toBe('unknown')
  })
})
