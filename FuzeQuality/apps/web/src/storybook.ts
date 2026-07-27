import type { StorybookStory } from '@fuzequality/contracts'

export function storybookPreviewUrl(baseUrl: string | undefined, story: StorybookStory) {
  if (!baseUrl) return undefined
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== 'https:') return undefined
    const preview = new URL(story.previewPath, `${base.toString().replace(/\/+$/, '')}/`)
    if (preview.origin !== base.origin) return undefined
    return preview.toString()
  } catch {
    return undefined
  }
}
