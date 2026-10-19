import { useState } from 'react';

export interface CodeBlockProps {
  code: string;
  language?: string;
  onAction?: (code: string, language: string) => void;
  actionLabel?: string;
}

/**
 * Fenced code block renderer for chat responses.
 * Provides syntax language badge, copy-to-clipboard button, and an optional
 * action button (e.g. "Run in Query Lab" for SQL/bi-query).
 */
export function CodeBlock({ code, language = '', onAction, actionLabel }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access fallback
    }
  };

  const normLang = language.toLowerCase().trim();
  const isQuery = normLang === 'sql' || normLang === 'bi-query' || normLang === 'graphql' || normLang === 'dwh';
  const showAction = Boolean(onAction && (actionLabel || isQuery));
  const effectiveActionLabel = actionLabel || (isQuery ? 'Run in Query Lab' : 'Execute');

  return (
    <div className="ffc-codeblock" data-lang={normLang}>
      <div className="ffc-codeblock__header">
        <span className="ffc-codeblock__lang">{normLang || 'code'}</span>
        <div className="ffc-codeblock__actions">
          {showAction && (
            <button
              type="button"
              className="ffc-codeblock__btn ffc-codeblock__btn--action"
              onClick={() => onAction?.(code, normLang)}
              title="Execute this query in the workspace"
            >
              ▶ {effectiveActionLabel}
            </button>
          )}
          <button
            type="button"
            className="ffc-codeblock__btn"
            onClick={handleCopy}
            aria-label="Copy code to clipboard"
          >
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>
      </div>
      <pre className="ffc-codeblock__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}
