/**
 * Serves the config-service OpenAPI contract as browsable Swagger UI, plus
 * the raw spec as JSON and YAML, for the authenticated-developer audience
 * decided in FF-EPIC-17-S9 / FFRNT-258:
 *
 *   GET /docs               — Swagger UI, rendering the committed contract.
 *   GET /docs/openapi.json  — the same contract, as JSON.
 *   GET /docs/openapi.yaml  — the same contract, as the raw committed YAML.
 *
 * Exposure policy (owner-decided, see docs/planning/epics/
 * EPIC-17-configuration-service-core.md's S9 story):
 *   - Authenticated-developer route, NOT public. Every route in this router
 *     is mounted behind `requireAuth` (the same JWT verifier that gates
 *     `/v1/*`) — an unauthenticated caller gets 401, never the docs.
 *   - Try-it is READ-ONLY: Swagger UI is configured with
 *     `supportedSubmitMethods: ['get']`, so the Execute button does not
 *     exist on write operations (POST/PUT). This is a UI-side control ONLY —
 *     it hides a button in the browser, it does NOT make the server refuse a
 *     write. The real security boundary is unchanged: every write still goes
 *     through `requireAuth` + Permit (`middleware/permit.ts`), which is what
 *     makes this safe — the console can only ever reach what the caller's
 *     own token already authorizes. `supportedSubmitMethods` removes the
 *     *accidental*-write risk (fat-fingering Execute on a live PUT), not a
 *     privilege-escalation risk, because there isn't one here.
 *   - Write exploration happens OFF this route: a non-prod `servers` entry
 *     or the Prism mock (`@stoplight/prism-cli`, already pinned and running
 *     in CI's `contract-tests` job — see `.github/workflows/ci.yml` — which
 *     auto-discovers every service's committed OpenAPI spec, this one
 *     included, and boots a mock of it) is the sandbox for trying writes;
 *     nothing here tries to make THIS route double as that sandbox.
 *
 * No drift: `/docs/openapi.json` and `/docs/openapi.yaml` are both derived
 * from THE SAME parse of the committed `openapi.yaml` at module load — the
 * YAML route serves the file's raw bytes verbatim and the JSON route is
 * `js-yaml`'s parse of those same bytes, so there is no second copy that
 * could silently diverge from the frozen contract. If the file fails to
 * parse, `load()` throws at require-time and the service fails to start
 * rather than serving a docs page that misdescribes the API (openapi.yaml
 * AC4) — tests additionally assert the parse succeeds and pin no-drift by
 * re-parsing the served response and diffing it against the source file.
 */

import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireAuth } from '../middleware/auth';

// __dirname at runtime: dist/routes/ (compiled) or src/routes/ (ts-node dev).
// openapi.yaml is at the service root (two levels up from src/routes/).
const SPEC_PATH = join(__dirname, '../../openapi.yaml');

/** Exposed for tests that want to assert byte-identity against the source file. */
export function loadRawSpecYaml(): string {
  return readFileSync(SPEC_PATH, 'utf8');
}

/** Parses the committed contract. Throws (fails startup) if it does not parse. */
export function loadSpec(): object {
  return load(loadRawSpecYaml()) as object;
}

const rawYaml = loadRawSpecYaml();
const spec = load(rawYaml) as object;

/**
 * `supportedSubmitMethods: ['get']` is the ENTIRE try-it-read-only control —
 * see module doc. It is never the security boundary; Permit + requireAuth
 * are.
 */
const swaggerOptions = {
  swaggerOptions: {
    supportedSubmitMethods: ['get'],
  },
};

export function createDocsRouter(): Router {
  const router = Router();

  // Authenticated-developer only, for the whole /docs subtree (the Swagger
  // UI HTML/JS assets served by swaggerUi.serve, AND the raw spec routes
  // below) — an unauthenticated caller never sees the docs, per policy.
  router.use(requireAuth);

  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(spec, swaggerOptions));

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.type('application/json').json(spec);
  });

  router.get('/openapi.yaml', (_req: Request, res: Response) => {
    res.type('application/yaml').send(rawYaml);
  });

  return router;
}
