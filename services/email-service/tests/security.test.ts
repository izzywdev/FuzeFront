/**
 * Security-focused unit tests for the email-service hardening:
 *  1. escapeHtml
 *  2. validateAndEscapeUrl
 *  3. action/role narrowing in membership-change template
 *  4. classifyProviderError → stable error codes
 */

import { escapeHtml, validateAndEscapeUrl, SAFE_URL_FALLBACK } from '../src/utils/html';
import { maskEmail } from '../src/utils/mask';
import { classifyProviderError } from '../src/utils/provider-error';
import { renderTemplate } from '../src/templates';

// ---------------------------------------------------------------------------
// 1. escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes & < > " \' /', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#x27;s');
    expect(escapeHtml('a/b')).toBe('a&#x2F;b');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('blocks XSS payloads', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });
});

// ---------------------------------------------------------------------------
// 2. validateAndEscapeUrl
// ---------------------------------------------------------------------------
describe('validateAndEscapeUrl', () => {
  it('accepts https URLs and escapes them', () => {
    const result = validateAndEscapeUrl('https://app.fuzefront.com/accept?token=abc&x=1');
    expect(result).toContain('https:');
    // Raw & in query string must be HTML-escaped to &amp;
    expect(result).toContain('&amp;');
    // The literal two-char sequence '&x' (unescaped ampersand followed by x) must not appear
    expect(result).not.toContain('&x');
  });

  it('accepts http URLs (dev allowlist)', () => {
    const result = validateAndEscapeUrl('http://localhost:3000/login');
    expect(result).toContain('http:');
  });

  it('rejects javascript: scheme and falls back', () => {
    const result = validateAndEscapeUrl('javascript:alert(1)');
    expect(result).toBe(escapeHtml(SAFE_URL_FALLBACK));
    expect(result).not.toContain('javascript');
  });

  it('rejects data: scheme and falls back', () => {
    const result = validateAndEscapeUrl('data:text/html,<h1>x</h1>');
    expect(result).toBe(escapeHtml(SAFE_URL_FALLBACK));
    expect(result).not.toContain('data:');
  });

  it('falls back on garbage input', () => {
    const result = validateAndEscapeUrl('not a url at all');
    expect(result).toBe(escapeHtml(SAFE_URL_FALLBACK));
  });

  it('falls back on empty string', () => {
    const result = validateAndEscapeUrl('');
    expect(result).toBe(escapeHtml(SAFE_URL_FALLBACK));
  });
});

// ---------------------------------------------------------------------------
// 3. action/role narrowing in membership-change template
// ---------------------------------------------------------------------------
describe('membership-change template narrowing', () => {
  it('accepts known actions', () => {
    for (const action of ['added', 'removed', 'updated', 'promoted', 'demoted']) {
      const result = renderTemplate('membership-change', { orgName: 'Acme', action, role: 'member' });
      expect(result.html).toContain(action);
    }
  });

  it('falls back to "updated" for unknown action', () => {
    const result = renderTemplate('membership-change', {
      orgName: 'Acme',
      action: '<evil>',
      role: 'member',
    });
    expect(result.html).toContain('updated');
    // The raw attacker value must not appear anywhere
    expect(result.html).not.toContain('<evil>');
    expect(result.html).not.toContain('evil');
  });

  it('accepts known roles', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer', 'guest']) {
      const result = renderTemplate('membership-change', { orgName: 'Acme', action: 'added', role });
      expect(result.html).toContain(role);
    }
  });

  it('falls back to "member" for unknown role', () => {
    const result = renderTemplate('membership-change', {
      orgName: 'Acme',
      action: 'added',
      role: 'superadmin<script>',
    });
    expect(result.html).toContain('member');
    expect(result.html).not.toContain('superadmin');
    expect(result.html).not.toContain('<script>');
  });

  it('HTML-escapes orgName', () => {
    const result = renderTemplate('membership-change', {
      orgName: '<Acme & Co>',
      action: 'added',
      role: 'member',
    });
    expect(result.html).not.toContain('<Acme');
    expect(result.html).toContain('&lt;Acme');
    expect(result.html).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// 4. classifyProviderError → stable error codes
// ---------------------------------------------------------------------------
describe('classifyProviderError', () => {
  it('classifies timeout errors', () => {
    expect(classifyProviderError('Connection timed out')).toBe('provider_timeout');
    expect(classifyProviderError('ETIMEDOUT')).toBe('provider_timeout');
    expect(classifyProviderError('ECONNRESET')).toBe('provider_timeout');
  });

  it('classifies 4xx / client errors', () => {
    expect(classifyProviderError('400 Bad Request')).toBe('provider_4xx');
    expect(classifyProviderError('401 Unauthorized')).toBe('provider_4xx');
    expect(classifyProviderError('403 Forbidden')).toBe('provider_4xx');
  });

  it('classifies 5xx / server errors', () => {
    expect(classifyProviderError('500 Internal Server Error')).toBe('provider_5xx');
    expect(classifyProviderError('502 Bad Gateway')).toBe('provider_5xx');
    expect(classifyProviderError('503 Service Unavailable')).toBe('provider_5xx');
  });

  it('classifies invalid recipient errors', () => {
    expect(classifyProviderError('Invalid recipient address')).toBe('invalid_recipient');
    expect(classifyProviderError('User unknown')).toBe('invalid_recipient');
    expect(classifyProviderError('email bounced')).toBe('invalid_recipient');
  });

  it('falls back to unknown for unrecognised messages', () => {
    expect(classifyProviderError('some obscure error')).toBe('unknown');
    expect(classifyProviderError('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 5. maskEmail
// ---------------------------------------------------------------------------
describe('maskEmail', () => {
  it('masks local part leaving first char and domain visible', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('bob@test.org')).toBe('b***@test.org');
  });

  it('handles edge cases gracefully', () => {
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('noatsign')).toBe('***');
  });
});
