import { describe, it, expect } from 'vitest';
import { classify, deriveFromMethod, ClassificationError } from '../src/classify.js';

describe('deriveFromMethod', () => {
  it('treats safe methods as reads', () => {
    for (const m of ['get', 'head', 'options', 'trace']) {
      const c = deriveFromMethod(m, '/tickets');
      expect(c.mutates, m).toBe(false);
      expect(c.reversibility, m).toBe('reversible');
    }
  });

  it('treats ordinary writes as reversible mutations', () => {
    for (const m of ['post', 'put', 'patch']) {
      const c = deriveFromMethod(m, '/tickets');
      expect(c.mutates, m).toBe(true);
      expect(c.reversibility, m).toBe('reversible');
    }
  });

  it('treats DELETE as irreversible by default', () => {
    const c = deriveFromMethod('delete', '/tickets/{id}');
    expect(c.mutates).toBe(true);
    expect(c.reversibility).toBe('irreversible');
  });

  it('treats query-shaped POSTs as reads', () => {
    for (const p of ['/tickets/search', '/kb/query', '/tickets/preview']) {
      const c = deriveFromMethod('post', p);
      expect(c.mutates, p).toBe(false);
    }
  });

  it('does not match query-shaped words mid-path', () => {
    // `/search-index/rebuild` must NOT be mistaken for a read just because it
    // contains "search" — this is the substring-vs-suffix bug the allowlist exists to avoid.
    const c = deriveFromMethod('post', '/search-index/rebuild');
    expect(c.mutates).toBe(true);
  });
});

describe('classify invariants', () => {
  it('refuses an irreversible operation declared as a read', () => {
    expect(() =>
      classify('post', '/approvals/{id}/decision', 'decide', {
        mutates: false,
        reversibility: 'irreversible',
      })
    ).toThrow(ClassificationError);
  });

  it('refuses to downgrade a non-query-shaped write to a read', () => {
    expect(() =>
      classify('post', '/approvals/{id}/decision', 'decide', { mutates: false })
    ).toThrow(ClassificationError);
  });

  it('allows downgrading a query-shaped POST to a read', () => {
    const c = classify('post', '/tickets/search', 'searchTickets', { mutates: false });
    expect(c.mutates).toBe(false);
  });

  it('refuses to call a safe method irreversible', () => {
    expect(() =>
      classify('get', '/tickets', 'listTickets', { reversibility: 'irreversible' })
    ).toThrow(ClassificationError);
  });

  it('allows marking a POST irreversible', () => {
    const c = classify('post', '/approvals/{id}/decision', 'decide', {
      reversibility: 'irreversible',
      reason: 'An approval decision is final from the requester side',
    });
    expect(c.mutates).toBe(true);
    expect(c.reversibility).toBe('irreversible');
    expect(c.reason).toMatch(/final/);
  });

  it('allows a product to declare a DELETE reversible when it has real undelete', () => {
    const c = classify('delete', '/kb/articles/{id}', 'deleteArticle', {
      reversibility: 'reversible',
      reason: 'Soft delete; restorable via PATCH',
    });
    expect(c.mutates).toBe(true);
    expect(c.reversibility).toBe('reversible');
  });
});
