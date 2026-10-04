// seed/packs.ts - platform default seed packs (plan section 10).
//
// Files: `services/selection-list-service/seed-packs/platform/<packKey>.v<version>.json`,
// validated against `selectionListSeedPackSchemaV1` (the same list/item rules as
// `seed.requested`). A released version file is IMMUTABLE (a change is a new
// `v<N+1>` file); the loader refuses two files claiming the same (packKey, version),
// a file whose name disagrees with its content, and any file that fails validation.
// Call `loadPlatformPacks()` at boot so a bad pack stops the service from starting
// instead of failing on the first org.

import fs from 'fs';
import path from 'path';
import { selectionListSeedPackSchemaV1, type SelectionListSeedPackV1 } from '@fuzefront/shared/kafka';

/** `<service>/seed-packs/platform`, resolved the same from src/ (ts-jest) and dist/ (compiled). */
export const DEFAULT_PLATFORM_PACK_DIR = path.resolve(__dirname, '..', '..', 'seed-packs', 'platform');

export class SeedPackError extends Error {
  readonly code = 'SEED_PACK_INVALID';
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`seed pack ${file} is invalid: ${issues.join('; ')}`);
    this.name = 'SeedPackError';
  }
}

export interface PlatformPack {
  pack: SelectionListSeedPackV1;
  file: string;
}

const FILE_RE = /^([a-z0-9][a-z0-9-]*[a-z0-9])\.v([1-9][0-9]*)\.json$/;

/** Every platform pack in `dir` (all versions), sorted by (packKey, version). Throws `SeedPackError`. */
export function loadPlatformPacks(dir: string = DEFAULT_PLATFORM_PACK_DIR): PlatformPack[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch (err) {
    throw new SeedPackError(dir, [`cannot read pack directory: ${(err as Error).message}`]);
  }
  const out: PlatformPack[] = [];
  const seen = new Map<string, string>();
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    const m = FILE_RE.exec(name);
    if (!m) throw new SeedPackError(file, ['file name must be <packKey>.v<version>.json']);
    let doc: unknown;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new SeedPackError(file, [`cannot read/parse: ${(err as Error).message}`]);
    }
    const parsed = selectionListSeedPackSchemaV1.safeParse(doc);
    if (!parsed.success) {
      throw new SeedPackError(
        file,
        (parsed as import('zod').SafeParseError<unknown>).error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      );
    }
    const pack = parsed.data;
    if (pack.packKey !== m[1] || pack.version !== Number(m[2])) {
      throw new SeedPackError(file, [`file name says ${m[1]} v${m[2]} but the content says ${pack.packKey} v${pack.version}`]);
    }
    const id = `${pack.packKey}@${pack.version}`;
    if (seen.has(id)) throw new SeedPackError(file, [`duplicate pack ${id} (also ${seen.get(id)})`]);
    seen.set(id, file);
    out.push({ pack, file });
  }
  return out.sort((a, b) => (a.pack.packKey === b.pack.packKey ? a.pack.version - b.pack.version : a.pack.packKey < b.pack.packKey ? -1 : 1));
}

/**
 * One platform pack: the HIGHEST version of `packKey` (default `platform-defaults`),
 * or exactly `version` when given. Throws `SeedPackError` when none matches.
 */
export function loadPlatformPack(
  packKey = 'platform-defaults',
  version?: number,
  dir: string = DEFAULT_PLATFORM_PACK_DIR,
): SelectionListSeedPackV1 {
  const matches = loadPlatformPacks(dir).filter((p) => p.pack.packKey === packKey && (version === undefined || p.pack.version === version));
  if (matches.length === 0) {
    throw new SeedPackError(dir, [`no platform pack ${packKey}${version === undefined ? '' : ` v${version}`}`]);
  }
  return matches[matches.length - 1].pack;
}

/** The newest version of every platform pack key (what a new org / the reconciler should hold). */
export function currentPlatformPacks(dir: string = DEFAULT_PLATFORM_PACK_DIR): SelectionListSeedPackV1[] {
  const latest = new Map<string, SelectionListSeedPackV1>();
  for (const { pack } of loadPlatformPacks(dir)) latest.set(pack.packKey, pack); // sorted ascending, last wins
  return [...latest.values()];
}
