import { describe, expect, it } from 'vitest'
import { adfToText, extractAcceptanceCriteria } from './adf'

describe('Jira ADF normalization', () => {
  const description = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The owner can export evidence.' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A viewer is rejected.' }] }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Exports retain their audit ID.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'inlineCard', attrs: { url: 'javascript:alert(1)', text: 'unsafe link' } },
        ],
      },
      {
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Role' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Result' }] }] },
          ],
        }],
      },
    ],
  }

  it('preserves headings, list structure, and tables while dropping unsafe link targets', () => {
    const text = adfToText(description)
    expect(text).toContain('## Acceptance criteria')
    expect(text).toContain('- The owner can export evidence.')
    expect(text).toContain('| Role | Result |')
    expect(text).toContain('unsafe link')
    expect(text).not.toContain('javascript:')
  })

  it('extracts, deduplicates, orders, and fingerprints criteria stably', () => {
    const criteria = extractAcceptanceCriteria(description, [
      '- A viewer is rejected.\n- Failed exports are auditable.',
    ])
    expect(criteria.map(item => item.text)).toEqual([
      'The owner can export evidence.',
      'A viewer is rejected.',
      'Exports retain their audit ID.',
      'Failed exports are auditable.',
    ])
    expect(criteria.map(item => item.position)).toEqual([1, 2, 3, 4])
    expect(criteria.every(item => /^[a-f0-9]{64}$/.test(item.fingerprint))).toBe(true)
    expect(extractAcceptanceCriteria(undefined, ['the OWNER can export evidence.'])[0].fingerprint)
      .toBe(criteria[0].fingerprint)
  })
})
