import { describe, expect, it } from 'vitest'
import { storybookPreviewUrl } from './storybook'

const story = {
  id: 'design-button--primary',
  title: 'Design/Button',
  name: 'Primary',
  exportName: 'Primary',
  sourcePath: 'src/Button.stories.tsx',
  hasPlay: false,
  previewPath: 'iframe.html?id=design-button--primary&viewMode=story',
}

describe('storybook preview URL', () => {
  it('builds a same-origin HTTPS iframe URL', () => {
    expect(storybookPreviewUrl('https://storybook.example.test/ui', story))
      .toBe('https://storybook.example.test/ui/iframe.html?id=design-button--primary&viewMode=story')
  })

  it('rejects non-HTTPS and cross-origin preview paths', () => {
    expect(storybookPreviewUrl('http://storybook.example.test', story)).toBeUndefined()
    expect(storybookPreviewUrl('https://storybook.example.test', {
      ...story,
      previewPath: 'https://attacker.example/iframe.html',
    })).toBeUndefined()
  })
})
