import type { ReactNode } from 'react';

/**
 * Minimal inline-markdown renderer for chat bubbles: **bold**, __bold__,
 * *italic*, and `code`. Deliberately NOT a full markdown parser (no HTML,
 * no dangerouslySetInnerHTML) — it tokenizes into plain React nodes, so
 * LLM-authored content can never inject markup.
 */
const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;

export function renderInlineMarkdown(text: string): ReactNode[] {
  return text
    .split(INLINE_PATTERN)
    .filter((part) => part.length > 0)
    .map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('__') && part.endsWith('__')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
}
