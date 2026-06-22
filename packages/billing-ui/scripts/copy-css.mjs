// Copy the component stylesheet into dist so `@fuzefront/billing-ui/styles.css`
// resolves for consumers. The CSS contains ONLY design-system token references
// (var(--bg-*), var(--space-*), var(--seam), …) and logical properties — no
// hard-coded colors / spacing / type.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src/styles/billing-ui.css');
const dest = resolve(here, '../dist/styles.css');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
// eslint-disable-next-line no-console
console.log('[billing-ui] copied styles.css -> dist/styles.css');
