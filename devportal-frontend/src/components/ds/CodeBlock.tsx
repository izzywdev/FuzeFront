/**
 * CodeBlock — read-only, copyable monospace surface for request/response bodies,
 * validator output and code samples.
 *
 * design/frames/devportal/manifest.json's `build.designSystemAdditions` calls this
 * out as a genuine base-design-system gap (forms/CodeField is an *editable* input,
 * not a read-only display surface) and asks for it as a foundation PR to
 * @fuzefront/design-system. Per this PR's explicit scope, adding new primitives to
 * the base is deferred — see the PR body. This is the product-local stand-in:
 * composed ENTIRELY from design-system tokens (var(--…), no raw hex/px) via
 * `.dp-code-block`/`.dp-code-block-header` in src/styles/devportal.css, plus the
 * DS `IconButton` for the copy action. It renders NOTHING that isn't a token —
 * so promoting it to the base later is a pure move, not a rewrite.
 */
import { useState } from 'react'
import { IconButton } from '@fuzefront/design-system'

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export function CodeBlock({
  code,
  title,
  copyable = true,
  ...rest
}: {
  code: string
  title?: string
  copyable?: boolean
  [key: string]: unknown
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable (e.g. insecure context) — silently no-op
    }
  }

  return (
    <div {...rest}>
      {(title || copyable) && (
        <div className="dp-code-block-header">
          <span>{title}</span>
          {copyable && (
            <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={handleCopy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconButton>
          )}
        </div>
      )}
      <pre className="dp-code-block">{code}</pre>
    </div>
  )
}
