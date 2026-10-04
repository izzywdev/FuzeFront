// seed/canonical.ts - canonical JSON + SHA-256 + the two text hashes the rest of the
// service already writes into `selection_list*_translations.source_hash`.
//
// `canonicalJson` is the byte-for-byte basis of every content hash in the seed
// algorithm (plan section 9: "SHA-256 over the canonical JSON of `lists`"): object
// keys sorted recursively, array order preserved, `undefined` members dropped (they
// do not exist in JSON), so two requests carrying the same content hash equal no
// matter how the producer happened to order its keys.

import { createHash } from 'crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v === undefined ? null : v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the canonical JSON of any value. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Same formula as routes/translations.ts `computeSourceHash` (non-source translation
 * rows carry the hash of the source text they were written against; autofill uses it
 * to decide whether a machine translation is stale). Duplicated, not imported, so the
 * library does not load the HTTP router.
 */
export function computeSourceHash(text: string, description?: string | null): string {
  return createHash('md5').update(`${text}|${description ?? ''}`).digest('hex');
}

/** Same formula as the `hashText` the list/item create routes put on the source-locale row. */
export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}
