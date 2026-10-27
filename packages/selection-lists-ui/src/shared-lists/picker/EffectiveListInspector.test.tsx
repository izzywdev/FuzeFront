import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  COMMON_ID,
  FORK_ID,
  makeCommonList,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'
import { EffectiveListInspector } from './EffectiveListInspector'

describe('EffectiveListInspector (frame 09 harness readout)', () => {
  it('an org fork: its id, org, visibility and the list it was forked from', () => {
    render(<EffectiveListInspector list={makeForkList()} />)
    const el = document.querySelector('[data-effective-inspector]')!
    expect(el).toHaveTextContent(FORK_ID)
    expect(el).toHaveTextContent('org org_01jf000000000000000000acme')
    expect(el).toHaveTextContent('visibility org')
    expect(el).toHaveTextContent(`forked_from ${COMMON_ID}`)
  })

  it('a common list: "platform org", visibility platform, no forked_from', () => {
    render(<EffectiveListInspector list={makeCommonList()} />)
    const el = document.querySelector('[data-effective-inspector]')!
    expect(el).toHaveTextContent(COMMON_ID)
    expect(el).toHaveTextContent('platform org')
    expect(el).toHaveTextContent('visibility platform')
    expect(el).not.toHaveTextContent('forked_from')
  })

  it('a list with no visibility field reads as private (absent = private)', () => {
    render(
      <EffectiveListInspector
        list={makeSharedList({ visibility: undefined })}
      />
    )
    expect(screen.getByText(/visibility private/)).toBeInTheDocument()
  })
})
