import type { ReactNode } from 'react';
import { CodeBlock } from '../components/CodeBlock';

/**
 * Minimal inline-markdown renderer for chat bubbles: **bold**, __bold__,
 * *italic*, and `code`. Deliberately NOT a full markdown parser (no HTML,
 * no dangerouslySetInnerHTML) — it tokenizes into plain React nodes, so
 * LLM-authored content can never inject markup.
 */
const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g;
const FENCE_PATTERN = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;

export interface MarkdownOptions {
  onCodeAction?: (code: string, language: string) => void;
  codeActionLabel?: string;
}

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

/**
 * Parses assistant responses with support for both inline tokens and fenced
 * code blocks (e.g. ```sql or ```bi-query) with interactive copy and execution actions.
 */
export function renderMessageMarkdown(text: string, options?: MarkdownOptions): ReactNode[] {
  if (!text) return [];

  // Plain inline rendering when there are no code fences
  if (!text.includes('```')) {
    return renderInlineMarkdown(text);
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset RegExp state
  FENCE_PATTERN.lastIndex = 0;

  while ((match = FENCE_PATTERN.exec(text)) !== null) {
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      nodes.push(...renderInlineMarkdown(textBefore));
    }

    const language = match[1] || '';
    const code = match[2];
    nodes.push(
      <CodeBlock
        key={`code-${match.index}`}
        code={code}
        language={language}
        onAction={options?.onCodeAction}
        actionLabel={options?.codeActionLabel}
      />
    );

    lastIndex = FENCE_PATTERN.lastIndex;
  }

  const textAfter = text.slice(lastIndex);
  if (textAfter) {
    nodes.push(...renderInlineMarkdown(textAfter));
  }

  return nodes;
}
