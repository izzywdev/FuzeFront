import { createHash } from 'node:crypto'

type AdfNode = {
  type?: unknown
  text?: unknown
  attrs?: Record<string, unknown>
  content?: unknown[]
  marks?: Array<{ type?: unknown; attrs?: Record<string, unknown> }>
}

export type NormalizedAcceptanceCriterion = {
  fingerprint: string
  position: number
  text: string
}

const compact = (value: string) => value.replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

function nodeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const node = value as AdfNode
  if (node.type === 'hardBreak') return '\n'
  const own = typeof node.text === 'string' ? node.text : ''
  const display = typeof node.attrs?.text === 'string'
    ? node.attrs.text
    : typeof node.attrs?.displayName === 'string' ? node.attrs.displayName : ''
  const children = Array.isArray(node.content) ? node.content.map(nodeText).join('') : ''
  const linkMark = node.marks?.find(mark => mark.type === 'link')
  const candidateHref = node.attrs?.href ?? node.attrs?.url ?? linkMark?.attrs?.href
  const href = typeof candidateHref === 'string' && /^https?:\/\//i.test(candidateHref)
    ? ` (${candidateHref})`
    : ''
  return `${own || display}${children}${href}`
}

function renderNode(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const node = value as AdfNode
  const content = Array.isArray(node.content) ? node.content : []
  const type = String(node.type ?? '')
  if (type === 'text' || type === 'mention' || type === 'inlineCard') return nodeText(node)
  if (type === 'hardBreak') return '\n'
  if (type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2))
    return `${'#'.repeat(level)} ${compact(content.map(nodeText).join(''))}`
  }
  if (type === 'paragraph') return compact(content.map(nodeText).join(''))
  if (type === 'listItem') return compact(content.map(child => renderNode(child, depth + 1)).join(' '))
  if (type === 'bulletList' || type === 'orderedList') {
    return content.map((child, index) => {
      const marker = type === 'orderedList' ? `${index + 1}.` : '-'
      return `${'  '.repeat(depth)}${marker} ${renderNode(child, depth + 1)}`
    }).join('\n')
  }
  if (type === 'table') return content.map(child => renderNode(child, depth)).filter(Boolean).join('\n')
  if (type === 'tableRow') return `| ${content.map(child => compact(nodeText(child))).join(' | ')} |`
  if (type === 'rule') return '---'
  return content.map(child => renderNode(child, depth)).filter(Boolean).join('\n')
}

export function adfToText(value: unknown): string {
  return compact(renderNode(value))
}

function criterionTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map(item => compact(item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''))).filter(Boolean)
  }
  if (!value || typeof value !== 'object') return []
  const node = value as AdfNode
  const content = Array.isArray(node.content) ? node.content : []
  if (['listItem', 'paragraph', 'taskItem', 'tableRow'].includes(String(node.type))) {
    return [compact(content.map(nodeText).join(' '))].filter(Boolean)
  }
  return content.flatMap(criterionTexts)
}

function descriptionCriteria(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const content = Array.isArray((value as AdfNode).content) ? (value as AdfNode).content! : []
  const result: string[] = []
  let insideCriteria = false
  for (const child of content) {
    const node = child && typeof child === 'object' ? child as AdfNode : {}
    if (node.type === 'heading') {
      insideCriteria = /^(?:acceptance\s+criteri(?:a|on)|ac)\s*:?​?$/i.test(compact(nodeText(node)))
      continue
    }
    if (insideCriteria) result.push(...criterionTexts(node))
  }
  return result
}

export function extractAcceptanceCriteria(
  description: unknown,
  configuredFields: unknown[] = [],
): NormalizedAcceptanceCriterion[] {
  const texts = [...descriptionCriteria(description), ...configuredFields.flatMap(criterionTexts)]
  const unique = new Map<string, string>()
  for (const value of texts) {
    const text = compact(value)
    if (!text) continue
    const fingerprint = createHash('sha256').update(text.toLowerCase()).digest('hex')
    if (!unique.has(fingerprint)) unique.set(fingerprint, text)
  }
  return [...unique].map(([fingerprint, text], index) => ({ fingerprint, position: index + 1, text }))
}
