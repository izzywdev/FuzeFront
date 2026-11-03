import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  makeCommonList,
  makeForkList,
  makeSharedList,
} from '../../test/sharedListsFixtures'
import { effectiveSourceOf } from '../core/derive'
import { EffectiveListSource } from './EffectiveListSource'

const caption = (c: HTMLElement) =>
  c.querySelector('[data-effective-source-caption]') as HTMLElement | null

describe('EffectiveListSource (frame 09, opt-in caption)', () => {
  it('renders nothing without a source (flag OFF, or the answer is not in yet)', () => {
    const { container } = render(
      <EffectiveListSource source={null} list={makeSharedList()} />
    )
    expect(container).toBeEmptyDOMElement()
    const undef = render(
      <EffectiveListSource source={undefined} list={makeSharedList()} />
    )
    expect(undef.container).toBeEmptyDOMElement()
  })

  it('common list: "Common list — provided by FuzeFront" with the Common badge', () => {
    const list = makeCommonList()
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    const c = caption(container)!
    expect(c).toHaveAttribute('data-effective-source-caption', 'platform')
    expect(c.querySelector("[data-badge='common']")).toHaveTextContent(
      'Common list'
    )
    expect(c).toHaveTextContent(/provided by FuzeFront/)
  })

  it("org fork: \"Your organization's version of the common list <name>\" with the Fork badge", () => {
    const list = makeForkList({ name: 'Priority' })
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    const c = caption(container)!
    expect(c).toHaveAttribute('data-effective-source-caption', 'own')
    expect(c.querySelector("[data-badge='fork']")).toHaveTextContent(
      "Your organization's version"
    )
    expect(c).toHaveTextContent('of the common list Priority')
    // The name is bidi-isolated so a Latin name inside RTL text keeps its order.
    expect(c.querySelector('bdi')).toHaveTextContent('Priority')
  })

  it('private fork: a draft only people with a role see', () => {
    const list = makeForkList({ visibility: 'private' })
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    const c = caption(container)!
    expect(c).toHaveAttribute('data-effective-source-caption', 'own')
    expect(c).toHaveTextContent(/Draft — only people with a role see this/)
    expect(c.querySelector('[data-badge]')).toBeNull()
  })

  it("a plain list of the organization's own: named, no badge", () => {
    const list = makeSharedList({ name: 'Regions' })
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    const c = caption(container)!
    expect(c).toHaveAttribute('data-effective-source-caption', 'own')
    expect(c).toHaveTextContent("Your organization's list Regions")
    expect(c.querySelector('[data-badge]')).toBeNull()
  })

  it('falls back to the key when the list has no name', () => {
    const list = makeForkList({ name: '' })
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    expect(caption(container)).toHaveTextContent('of the common list priority')
  })

  it('uses logical wrapping only: the caption wraps under the control and never widens it', () => {
    const list = makeCommonList()
    const { container } = render(
      <EffectiveListSource source={effectiveSourceOf(list)} list={list} />
    )
    const style = caption(container)!.style
    expect(style.flexWrap).toBe('wrap')
    expect(style.maxInlineSize).toBe('100%')
  })
})
