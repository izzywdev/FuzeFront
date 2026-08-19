import { createHash } from 'node:crypto'

/**
 * Per-key source hash for idempotency. We store a sidecar of
 * `key -> sourceHash` alongside each language's locale file. On the next run a
 * key is re-translated only when its English source hash differs (changed key)
 * or no translation exists yet (missing key). Unchanged keys are skipped, so
 * the same inputs produce byte-identical outputs and never re-spend on the LLM.
 */
export function sourceHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

export const META_SUFFIX = '.meta.json'

export interface LocaleMeta {
  /** Translated-from source-language hash, per key. */
  hashes: Record<string, string>
}

export function emptyMeta(): LocaleMeta {
  return { hashes: {} }
}
